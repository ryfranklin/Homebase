"""The CI regression gate for retrieval quality.

IMPORTANT — what this gate proves and does not prove:

- It runs OFFLINE against the committed synthetic fixtures, with no AWS
  credentials. It guards against REGRESSIONS in the retrieval CODE (the ranking,
  filtering, and rerank-fold logic): if a change drops fixture hit_rate / MRR
  below the committed floor, the gate fails the merge.
- It does NOT measure absolute retrieval quality on your real corpus. That is the
  separate LIVE eval you run by hand against your real vault (the ADR-002 gate).
  A green CI gate is not a quality guarantee for production retrieval.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .runner import score

# Committed floors. The fixtures currently score hit_rate@3 = 1.0 and MRR ~0.94
# with rerank; these floors leave headroom for noise while catching real drops.
DEFAULT_MIN_RERANKED_HIT_RATE = 0.75
DEFAULT_MIN_RERANKED_MRR = 0.60
# Rerank must keep pulling its weight; if lift collapses, something regressed.
DEFAULT_MIN_HIT_RATE_LIFT = 0.0


@dataclass(frozen=True)
class GateResult:
    passed: bool
    reasons: list = field(default_factory=list)
    scorecard: object = None


def evaluate_gate(
    cases,
    retriever,
    k,
    *,
    min_reranked_hit_rate=DEFAULT_MIN_RERANKED_HIT_RATE,
    min_reranked_mrr=DEFAULT_MIN_RERANKED_MRR,
    min_hit_rate_lift=DEFAULT_MIN_HIT_RATE_LIFT,
) -> GateResult:
    sc = score(cases, retriever, k, mode="gate")
    reasons = []
    if sc.reranked_hit_rate < min_reranked_hit_rate:
        reasons.append(
            f"reranked hit_rate@{k} {sc.reranked_hit_rate:.3f} < floor {min_reranked_hit_rate:.3f}"
        )
    if sc.reranked_mrr < min_reranked_mrr:
        reasons.append(f"reranked MRR {sc.reranked_mrr:.3f} < floor {min_reranked_mrr:.3f}")
    if sc.hit_rate_lift < min_hit_rate_lift:
        reasons.append(
            f"rerank hit_rate lift {sc.hit_rate_lift:+.3f} < floor {min_hit_rate_lift:+.3f}"
        )
    return GateResult(passed=len(reasons) == 0, reasons=reasons, scorecard=sc)
