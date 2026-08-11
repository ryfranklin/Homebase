"""The Homebase agent.

Contract the harness and tests rely on:
- A grounded answer ALWAYS carries at least one citation with source metadata.
- When retrieval finds nothing, the agent returns a "no relevant sources" answer
  with grounded=False and no citations, rather than hallucinating.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .llm import MockLLMClient
from .memory import NullMemory
from .prompts import load_system_prompt
from .toolloop import Outcome, run_tool_loop

NO_SOURCES_MESSAGE = (
    "I do not have a relevant source in your knowledge base for that, so I cannot answer it."
)

# The knowledge-base search tool, added alongside the connector tools in the loop.
SEARCH_KB_TOOL = {
    "toolSpec": {
        "name": "search_knowledge_base",
        "description": (
            "Search the user's private knowledge base (documents, ADRs, runbooks, notes) "
            "for relevant, cited passages. Use for questions about their own documents."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            }
        },
    }
}

# Appended to the base prompt only in tool-loop (connectors) mode.
_TOOL_SYSTEM_SUFFIX = """

You can call tools:
- search_knowledge_base: the user's private knowledge base. For questions about their
  own documents, notes, ADRs or runbooks, call this and answer ONLY from the returned
  passages, citing their sources. If it returns no passages, say you have no relevant
  source rather than guessing.
- slack_read_messages, gmail_search_messages, gcal_list_events, gdrive_search_files,
  jira_search_issues: read the user's live accounts. Use these for questions about
  Slack, email, calendar, Drive, or Jira. If a connector reports it needs
  authorization, share the link it provides so the user can connect that account.

Prefer calling a tool over guessing. Keep answers concise and grounded in tool output.
"""


@dataclass(frozen=True)
class Citation:
    source_path: str
    score: float | None = None
    metadata: dict = field(default_factory=dict)
    location_uri: str = ""


@dataclass(frozen=True)
class AnswerResult:
    text: str
    grounded: bool
    citations: list = field(default_factory=list)
    session: object = None
    authorization_url: str | None = None


class Agent:
    def __init__(self, retrieval, llm=None, memory=None, *, system_prompt=None, connectors=None):
        self._retrieval = retrieval
        self._llm = llm or MockLLMClient()
        self._memory = memory or NullMemory()
        self._system_prompt = system_prompt if system_prompt is not None else load_system_prompt()
        # When set, answer() runs a tool-use loop with the knowledge base AND the
        # connector read tools; otherwise it uses the single-shot RAG path below.
        self._connectors = connectors

    def _remember(self, session, role, text):
        # Memory is best-effort context, never on the answer's critical path: a
        # memory backend hiccup must not fail the user's request.
        try:
            self._memory.record_turn(session, role, text)
        except Exception:  # noqa: BLE001 (best-effort by design)
            pass

    def _citations_from_passages(self, passages):
        return [
            Citation(
                source_path=p.source_path,
                score=p.score,
                metadata=p.metadata,
                location_uri=p.location_uri,
            )
            for p in passages
        ]

    def _answer_with_tools(self, session, question) -> AnswerResult:
        def execute(name, tool_input):
            if name == "search_knowledge_base":
                passages = self._retrieval.retrieve(tool_input.get("query") or question)
                result = {
                    "passages": [{"source": p.source_path, "text": p.text} for p in passages]
                }
                return Outcome(result=result, citations=self._citations_from_passages(passages))
            # A connector read tool: invoke its shim; surface a consent prompt if the
            # user has not linked that account yet.
            data = self._connectors.call(name, tool_input, session.tenant_id)
            if isinstance(data, dict) and data.get("requires_authorization"):
                return Outcome(result={"status": "authorization_required"}, authorization_url=data.get("authorization_url"))
            return Outcome(result=data if isinstance(data, dict) else {"result": data})

        tools = [SEARCH_KB_TOOL, *self._connectors.tool_specs()]
        loop = run_tool_loop(
            self._llm,
            system=self._system_prompt + _TOOL_SYSTEM_SUFFIX,
            question=question,
            tools=tools,
            execute=execute,
        )

        self._remember(session, "user", question)
        if loop.text:
            self._remember(session, "assistant", loop.text)
        return AnswerResult(
            text=loop.text,
            grounded=loop.grounded,
            citations=loop.citations,
            session=session,
            authorization_url=loop.authorization_url,
        )

    def answer(self, session, question, **retrieval_kwargs) -> AnswerResult:
        if self._connectors is not None:
            return self._answer_with_tools(session, question)

        passages = self._retrieval.retrieve(question, **retrieval_kwargs)

        if not passages:
            # No relevant sources: say so, do not invent an answer.
            result = AnswerResult(
                text=NO_SOURCES_MESSAGE,
                grounded=False,
                citations=[],
                session=session,
            )
            self._remember(session, "user", question)
            return result

        text = self._llm.generate(
            system=self._system_prompt,
            question=question,
            passages=passages,
            session=session,
        )

        citations = [
            Citation(
                source_path=p.source_path,
                score=p.score,
                metadata=p.metadata,
                location_uri=p.location_uri,
            )
            for p in passages
        ]

        # Invariant: a grounded answer must carry citations.
        if not citations:
            raise AssertionError("grounded answer produced without citations")

        self._remember(session, "user", question)
        self._remember(session, "assistant", text)

        return AnswerResult(text=text, grounded=True, citations=citations, session=session)
