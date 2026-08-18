"""Run one suite across many models and build a leaderboard.

This is the core of the multi-model harness: a matrix of (model x case). For each
target and case it calls the model once (or ``repeats`` times, averaged), scores
the four metrics, and aggregates per model into a ModelScorecard. The output is a
leaderboard the deployed stack stores and a markdown table it can publish.
"""

from __future__ import annotations

from .gen_models import CaseScore, ModelScorecard
from .metrics import mean
from .scorers import score_cost, score_latency, score_quality, score_success


def run_matrix(cases, targets, *, judge, pricing, repeats: int = 1, on_case=None) -> list:
    """Score every (target, case) pair. Returns a flat list of CaseScore.

    repeats > 1 averages the numeric metrics over repeated calls (latency and
    cost vary run to run); success and quality are taken from the last call.

    on_case, if given, is called once per (target, case) as
    on_case(case, last_response, case_score). The batch runner uses it to persist
    the raw response and emit metrics without re-implementing the scoring loop.
    """
    scores = []
    for target in targets:
        for case in cases:
            latencies, costs, qualities = [], [], []
            last_response = None
            quality_rationale = ""
            for _ in range(max(1, repeats)):
                response = target.generate(case)
                last_response = response
                latencies.append(score_latency(response))
                costs.append(score_cost(response, target.model_id, pricing))
                q, quality_rationale = score_quality(case, response, judge)
                qualities.append(q)
            assert last_response is not None  # repeats >= 1, so the loop always ran
            success = score_success(case, last_response)
            case_score = CaseScore(
                case_id=case.id,
                model=target.model_id,
                quality=mean(qualities),
                quality_rationale=quality_rationale,
                latency_ms=mean(latencies),
                cost_usd=mean(costs),
                success=success,
                input_tokens=last_response.input_tokens,
                output_tokens=last_response.output_tokens,
                tenant_id=case.tenant_id,
                user_id=case.user_id,
                error=last_response.error,
            )
            scores.append(case_score)
            if on_case is not None:
                on_case(case, last_response, case_score)
    return scores


def percentile(values, pct: float) -> float:
    """Nearest-rank percentile (pct in 0..100). Empty -> 0.0."""
    values = sorted(values)
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    rank = pct / 100.0 * (len(values) - 1)
    low = int(rank)
    high = min(low + 1, len(values) - 1)
    frac = rank - low
    return values[low] + (values[high] - values[low]) * frac


def scorecards(case_scores) -> list:
    """Aggregate per-case scores into one ModelScorecard per model."""
    by_model = {}
    for score in case_scores:
        by_model.setdefault(score.model, []).append(score)

    cards = []
    for model, rows in by_model.items():
        latencies = [r.latency_ms for r in rows]
        cards.append(
            ModelScorecard(
                model=model,
                n_cases=len(rows),
                avg_quality=mean(r.quality for r in rows),
                p50_latency_ms=percentile(latencies, 50),
                p95_latency_ms=percentile(latencies, 95),
                avg_cost_usd=mean(r.cost_usd for r in rows),
                total_cost_usd=sum(r.cost_usd for r in rows),
                success_rate=mean(1.0 if r.success else 0.0 for r in rows),
                n_errors=sum(1 for r in rows if r.error),
            )
        )
    # Best first: quality desc, then cost asc as the tie-breaker.
    cards.sort(key=lambda c: (-c.avg_quality, c.avg_cost_usd))
    return cards


def format_leaderboard(cards, *, suite: str = "", title: str = "Model leaderboard") -> str:
    """Render the scorecards as a Markdown table, best model first."""
    header = f"# {title}"
    if suite:
        header += f"  (suite: {suite})"
    lines = [
        header,
        "",
        "| rank | model | quality | success | p50 ms | p95 ms | avg $ | total $ | errors |",
        "| ---- | ----- | ------- | ------- | ------ | ------ | ----- | ------- | ------ |",
    ]
    for i, c in enumerate(cards, start=1):
        lines.append(
            f"| {i} | `{c.model}` | {c.avg_quality:.3f} | {c.success_rate:.0%} | "
            f"{c.p50_latency_ms:.0f} | {c.p95_latency_ms:.0f} | "
            f"${c.avg_cost_usd:.5f} | ${c.total_cost_usd:.5f} | {c.n_errors} |"
        )
    lines.append("")
    lines.append(
        "Ranked by quality, then cost. Cost uses the pricing table (verify against "
        "current Bedrock pricing). Quality is a judge score in [0, 1]."
    )
    return "\n".join(lines)


def tag_breakdown(cases, case_scores) -> dict:
    """Per-capability view: average quality and success by (tag, model).

    Joins scores back to their cases by id to recover tags. Returns
    {tag: [(model, avg_quality, success_rate, n), ...]} with each tag's models
    sorted best-quality first. This is what turns a leaderboard into "who wins
    coding vs reasoning vs instruction-following".
    """
    tags_by_case = {c.id: (list(c.tags) if c.tags else ["untagged"]) for c in cases}

    grouped = {}
    for score in case_scores:
        for tag in tags_by_case.get(score.case_id, ["untagged"]):
            grouped.setdefault((tag, score.model), []).append(score)

    by_tag = {}
    for (tag, model), rows in grouped.items():
        by_tag.setdefault(tag, []).append(
            (
                model,
                mean(r.quality for r in rows),
                mean(1.0 if r.success else 0.0 for r in rows),
                len(rows),
            )
        )
    for tag in by_tag:
        by_tag[tag].sort(key=lambda row: -row[1])
    return dict(sorted(by_tag.items()))


def format_tag_breakdown(by_tag) -> str:
    """Render the tag breakdown as Markdown, one small table per capability."""
    lines = ["## By capability", ""]
    for tag, rows in by_tag.items():
        lines.append(f"### {tag}")
        lines.append("| model | quality | success | n |")
        lines.append("| ----- | ------- | ------- | - |")
        for model, quality, success, n in rows:
            lines.append(f"| `{model}` | {quality:.3f} | {success:.0%} | {n} |")
        lines.append("")
    return "\n".join(lines)
