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

NO_SOURCES_MESSAGE = (
    "I do not have a relevant source in your knowledge base for that, so I cannot answer it."
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


class Agent:
    def __init__(self, retrieval, llm=None, memory=None, *, system_prompt=None):
        self._retrieval = retrieval
        self._llm = llm or MockLLMClient()
        self._memory = memory or NullMemory()
        self._system_prompt = system_prompt if system_prompt is not None else load_system_prompt()

    def answer(self, session, question, **retrieval_kwargs) -> AnswerResult:
        passages = self._retrieval.retrieve(question, **retrieval_kwargs)

        if not passages:
            # No relevant sources: say so, do not invent an answer.
            result = AnswerResult(
                text=NO_SOURCES_MESSAGE,
                grounded=False,
                citations=[],
                session=session,
            )
            self._memory.record_turn(session, "user", question)
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

        self._memory.record_turn(session, "user", question)
        self._memory.record_turn(session, "assistant", text)

        return AnswerResult(text=text, grounded=True, citations=citations, session=session)
