"""The Homebase agent.

Contract the harness and tests rely on:
- A grounded answer ALWAYS carries at least one citation with source metadata.
- When retrieval finds nothing, the agent returns a "no relevant sources" answer
  with grounded=False and no citations, rather than hallucinating.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .llm import MockLLMClient
from .memory import NullMemory
from .prompts import load_planning_prompt, load_system_prompt, load_vault_only_prompt
from .toolloop import Outcome, run_tool_loop, run_tool_loop_stream

# Prefix stamped on any answer that comes from the model's general knowledge rather than
# the user's own sources. It keeps the grounded/ungrounded boundary visible to the user:
# a reply that opens with this is, by contract, grounded=False and carries no citations.
GENERAL_KNOWLEDGE_DISCLAIMER = "Not from your knowledge base: "

# Instruction used only for the general-knowledge fallback (the no-passages branch of the
# single-shot RAG path). The Python layer prepends GENERAL_KNOWLEDGE_DISCLAIMER, so the model
# is told NOT to add its own disclaimer or citations here.
_GENERAL_INSTRUCTION = (
    "Answer the user's question from your general knowledge, concisely and helpfully. This is "
    "not drawn from the user's private knowledge base, so do not cite sources, do not claim to "
    "quote their documents, and do not add your own 'not from your knowledge base' disclaimer "
    "(the caller adds one)."
)


def _resolve_zone(tz_name):
    if tz_name:
        try:
            return ZoneInfo(tz_name)
        except (ZoneInfoNotFoundError, ValueError):
            pass  # unknown tz -> fall back to UTC rather than fail the answer
    return timezone.utc


def _now_preamble(now=None, tz_name=None) -> str:
    """A fresh date/time line prepended to the system prompt each request, so the
    model resolves 'today', 'this week', 'now', etc. against the real current date
    (in the configured timezone) instead of a date from its training data. Calendar
    and other relative-time questions depend on this.
    """
    now = (now or datetime.now(timezone.utc)).astimezone(_resolve_zone(tz_name))
    label = now.strftime("%Z") or "UTC"
    return (
        f"Current date and time: {now.strftime('%Y-%m-%d %H:%M')} {label} ({now.strftime('%A')}). "
        "Resolve relative times ('today', 'tomorrow', 'this week', 'now') against this "
        f"current date and time (timezone {label}), never a date from your training data."
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
  own documents, notes, ADRs or runbooks, call this and answer from the returned
  passages, citing their sources. If it returns no relevant passages, you may answer from
  your general knowledge instead, but prefix that part with a clear disclaimer like
  "Not from your knowledge base:" and do not attach a citation to it.
- slack_read_messages, gmail_search_messages, gcal_list_events, gdrive_search_files,
  jira_search_issues, confluence_search: read the user's live accounts. Use these for
  questions about Slack, email, calendar, Drive, Jira, or Confluence. If a connector
  reports it needs authorization, share the link it provides so the user can connect
  that account.

Prefer a tool over guessing for anything about the user's own world. When you do fall back to
general knowledge, label it plainly so the grounded and general parts stay distinct.
"""


# The plan being revised is folded into the operator's turn (not the system prompt or
# memory) so the planning agent edits the existing flight plan instead of drafting a new
# one. Trimmed defensively: a runaway plan JSON must not blow the model's context.
_MAX_PLAN_CONTEXT_CHARS = 20000


def _with_plan_context(question: str, plan_context) -> str:
    if not plan_context:
        return question
    plan_json = str(plan_context)[:_MAX_PLAN_CONTEXT_CHARS]
    return (
        "The operator is revising an existing flight plan. Here is its current state as JSON:\n\n"
        f"```homebase-plan\n{plan_json}\n```\n\n"
        "Apply the operator's request below as an edit to THIS plan. Preserve acceptance criteria "
        "that are not changing (keep their statements verbatim); only add, reword, or drop what the "
        "request calls for. When you emit the plan draft, emit the full updated plan.\n\n"
        f"Operator: {question}"
    )


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
    def __init__(self, retrieval, llm=None, memory=None, *, system_prompt=None, connectors=None, allowed_models=None):
        self._retrieval = retrieval
        self._llm = llm or MockLLMClient()
        self._memory = memory or NullMemory()
        # Models a request is allowed to select (the GUI's settings-level default). A
        # request asking for anything outside this set silently falls back to the
        # deploy-time default, so a client can never invoke an arbitrary model. Empty
        # set -> selection disabled, the default model is always used.
        self._allowed_models = set(allowed_models or ())
        self._system_prompt = system_prompt if system_prompt is not None else load_system_prompt()
        # The AI-DLC INCEPTION prompt, swapped in when a request runs in plan mode so
        # the agent conducts the planning interview and emits a flight-plan draft.
        self._planning_prompt = load_planning_prompt()
        # Strict vault-only prompt, swapped in when the chat scope is 'vault': answer
        # only from the KB + connectors, never general knowledge.
        self._vault_only_prompt = load_vault_only_prompt()
        # IANA timezone for resolving 'today'/'now' (e.g. America/Chicago). Set on the
        # runtime via HOMEBASE_TIMEZONE; falls back to UTC when unset/unknown.
        self._timezone = os.environ.get("HOMEBASE_TIMEZONE")
        # When set, answer() runs a tool-use loop with the knowledge base AND the
        # connector read tools; otherwise it uses the single-shot RAG path below.
        self._connectors = connectors
        # Output-token budget for plan mode. A flight-plan draft (the fenced JSON block)
        # runs long; the default 1024 truncates it mid-object so the block never closes
        # and cannot be applied. Overridable via HOMEBASE_PLANNING_MAX_TOKENS.
        self._planning_max_tokens = int(os.environ.get("HOMEBASE_PLANNING_MAX_TOKENS", "4096"))

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

    def supports_streaming(self) -> bool:
        return self._connectors is not None

    def _resolve_llm(self, model, *, planning: bool = False):
        # Honor a requested model only if it is in the allow-list; otherwise use the
        # default. Returns the LLM client to use for this request.
        llm = self._llm.with_model(model) if (model and model in self._allowed_models) else self._llm
        # Plan mode must emit a complete flight-plan draft (a fenced JSON block); the
        # default output cap truncates it mid-object, leaving an unparseable block. Give
        # planning a larger budget. Guarded so lightweight test doubles are unaffected.
        if planning and hasattr(llm, "with_max_tokens"):
            llm = llm.with_max_tokens(self._planning_max_tokens)
        return llm

    def _make_execute(self, session, question):
        """The tool dispatcher shared by the buffered and streaming loops."""

        def execute(name, tool_input):
            if name == "search_knowledge_base":
                passages = self._retrieval.retrieve(tool_input.get("query") or question)
                result = {"passages": [{"source": p.source_path, "text": p.text} for p in passages]}
                return Outcome(result=result, citations=self._citations_from_passages(passages))
            # A connector read tool: invoke its shim; surface a consent prompt if the
            # user has not linked that account yet.
            data = self._connectors.call(name, tool_input, session.tenant_id)
            if isinstance(data, dict) and data.get("requires_authorization"):
                return Outcome(result={"status": "authorization_required"}, authorization_url=data.get("authorization_url"))
            return Outcome(result=data if isinstance(data, dict) else {"result": data})

        return execute

    def _tools(self):
        return [SEARCH_KB_TOOL, *self._connectors.tool_specs()]

    def _system(self, suffix: str = "", *, planning: bool = False, scope: str = "general") -> str:
        # Fresh date/time preamble each request so relative-time questions resolve.
        # Plan mode swaps the base prompt for the AI-DLC INCEPTION interview prompt;
        # otherwise scope 'vault' uses the strict vault-only prompt and 'general' uses
        # the default (grounded-first, with a labeled general fallback).
        if planning:
            base = self._planning_prompt
        elif scope == "vault":
            base = self._vault_only_prompt
        else:
            base = self._system_prompt
        return _now_preamble(tz_name=self._timezone) + "\n\n" + base + suffix

    def _general_system(self) -> str:
        # System prompt for the general-knowledge fallback: no vault-grounding rules, just
        # a concise general answer. The disclaimer is added by the caller, not the model.
        return _now_preamble(tz_name=self._timezone) + "\n\n" + _GENERAL_INSTRUCTION

    def _answer_with_tools(self, session, question, *, planning: bool = False, model=None, scope: str = "general", plan_context=None) -> AnswerResult:
        asked = _with_plan_context(question, plan_context) if planning else question
        loop = run_tool_loop(
            self._resolve_llm(model, planning=planning),
            system=self._system(_TOOL_SYSTEM_SUFFIX, planning=planning, scope=scope),
            question=asked,
            tools=self._tools(),
            execute=self._make_execute(session, question),
        )

        # Remember the operator's own words, not the plan JSON we fold in for context.
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

    def answer_stream(self, session, question, *, planning: bool = False, model=None, scope: str = "general", plan_context=None):
        """Streaming variant: a generator yielding SSE-ready events (token / citation
        / authorization_required / done) as the tool loop runs. Requires connectors
        (a tool-capable LLM); callers should gate on supports_streaming(). In plan
        mode the AI-DLC interview prompt is used and the reply carries a flight-plan
        draft block; a plan_context (the plan being revised, as JSON) is folded in so
        the agent edits the existing plan rather than starting from scratch. Scope
        'vault' uses the strict vault-only prompt (no general knowledge); 'general'
        (default) allows a labeled general fallback."""
        if self._connectors is None:
            # Degrade gracefully to a single token from the buffered path.
            result = self.answer(session, question, planning=planning, model=model, scope=scope, plan_context=plan_context)
            yield {"type": "token", "text": result.text}
            for citation in result.citations:
                yield {"type": "citation", "source_path": citation.source_path, "score": citation.score}
            yield {"type": "done"}
            return

        asked = _with_plan_context(question, plan_context) if planning else question
        text_parts: list = []
        for event in run_tool_loop_stream(
            self._resolve_llm(model, planning=planning),
            system=self._system(_TOOL_SYSTEM_SUFFIX, planning=planning, scope=scope),
            question=asked,
            tools=self._tools(),
            execute=self._make_execute(session, question),
        ):
            if event["type"] == "token":
                text_parts.append(event["text"])
            yield event

        self._remember(session, "user", question)
        final_text = "".join(text_parts)
        if final_text:
            self._remember(session, "assistant", final_text)

    def answer(self, session, question, *, planning: bool = False, model=None, scope: str = "general", plan_context=None, **retrieval_kwargs) -> AnswerResult:
        if self._connectors is not None:
            return self._answer_with_tools(session, question, planning=planning, model=model, scope=scope, plan_context=plan_context)

        llm = self._resolve_llm(model, planning=planning)
        passages = self._retrieval.retrieve(question, **retrieval_kwargs)

        if not passages:
            if scope == "vault":
                # Vault-only: never fall back to general knowledge. Say it plainly.
                text = "I could not find anything about that in your vault or connected accounts."
                self._remember(session, "user", question)
                self._remember(session, "assistant", text)
                return AnswerResult(text=text, grounded=False, citations=[], session=session)
            # General scope: fall back to general knowledge, stamped with a disclaimer so
            # the answer stays visibly ungrounded (grounded=False, no citations).
            body = llm.generate_general(system=self._general_system(), question=question)
            text = GENERAL_KNOWLEDGE_DISCLAIMER + body
            self._remember(session, "user", question)
            self._remember(session, "assistant", text)
            return AnswerResult(text=text, grounded=False, citations=[], session=session)

        text = llm.generate(
            system=self._system(scope=scope),
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
