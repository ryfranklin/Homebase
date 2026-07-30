"""Score a set of cases with a retriever, producing a Scorecard."""

from __future__ import annotations

from .metrics import hit_at_k, mean, reciprocal_rank
from .models import Scorecard


def score(cases, retriever, k: int, mode: str = "offline") -> Scorecard:
    base_hits, base_rr, rr_hits, rr_rr = [], [], [], []

    for case in cases:
        result = retriever.retrieve(case)
        expected = case.expected_sources
        base_hits.append(hit_at_k(result.base, expected, k))
        base_rr.append(reciprocal_rank(result.base, expected))
        rr_hits.append(hit_at_k(result.reranked, expected, k))
        rr_rr.append(reciprocal_rank(result.reranked, expected))

    return Scorecard(
        mode=mode,
        k=k,
        n_cases=len(cases),
        base_hit_rate=mean(base_hits),
        base_mrr=mean(base_rr),
        reranked_hit_rate=mean(rr_hits),
        reranked_mrr=mean(rr_rr),
    )


def format_scorecard(scorecard: Scorecard) -> str:
    s = scorecard
    lines = [
        f"Retrieval scorecard  (mode={s.mode}, k={s.k}, N={s.n_cases})",
        "",
        f"  metric        base      rerank    lift",
        f"  hit_rate@{s.k:<3}  {s.base_hit_rate:6.3f}    {s.reranked_hit_rate:6.3f}    {s.hit_rate_lift:+.3f}",
        f"  MRR           {s.base_mrr:6.3f}    {s.reranked_mrr:6.3f}    {s.mrr_lift:+.3f}",
        "",
    ]
    verdict = "positive" if (s.hit_rate_lift > 0 or s.mrr_lift > 0) else "not positive"
    lines.append(
        f"  Rerank lift is {verdict}: rerank changes hit_rate@{s.k} by {s.hit_rate_lift:+.3f} "
        f"and MRR by {s.mrr_lift:+.3f}."
    )
    lines.append("  Rerank earns its extra call only where the lift justifies the cost.")
    return "\n".join(lines)
