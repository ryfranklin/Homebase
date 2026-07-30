"""Data models for the eval harness."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class Case:
    """A single evaluation case: a question and the source(s) that should be
    retrieved for it. For offline scoring, the case also carries the base and
    reranked rankings a retriever would produce, so the harness is deterministic
    without any AWS calls.
    """

    id: str
    question: str
    expected_sources: list = field(default_factory=list)
    offline_base: list = field(default_factory=list)
    offline_reranked: list = field(default_factory=list)


@dataclass(frozen=True)
class RetrievalResult:
    """Ranked source ids returned for a case, without rerank and with rerank."""

    base: list
    reranked: list


@dataclass(frozen=True)
class Scorecard:
    mode: str
    k: int
    n_cases: int
    base_hit_rate: float
    base_mrr: float
    reranked_hit_rate: float
    reranked_mrr: float

    @property
    def hit_rate_lift(self) -> float:
        return self.reranked_hit_rate - self.base_hit_rate

    @property
    def mrr_lift(self) -> float:
        return self.reranked_mrr - self.base_mrr


def load_cases(path) -> list:
    """Load evaluation cases from a JSON file."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    cases = []
    for item in raw["cases"]:
        offline = item.get("offline", {})
        cases.append(
            Case(
                id=item["id"],
                question=item["question"],
                expected_sources=list(item.get("expected_sources", [])),
                offline_base=list(offline.get("base_ranking", [])),
                offline_reranked=list(offline.get("reranked_ranking", [])),
            )
        )
    return cases
