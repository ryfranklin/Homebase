"""Offline tests for the multi-model matrix and leaderboard. No AWS."""

from __future__ import annotations

import json

from homebase_eval.gen_models import GenCase
from homebase_eval.matrix import format_leaderboard, percentile, run_matrix, scorecards
from homebase_eval.targets import MockModelTarget


def _cases():
    return [
        GenCase(id="q1", prompt="p1", reference="answer one"),
        GenCase(id="q2", prompt="p2", reference="answer two", expect_contains=["two"]),
    ]


def _judge():
    # Rewards the strong model's echoed reference; penalizes the hedge.
    def responder(jc):
        weak = "not sure" in jc.prompt.lower()
        return json.dumps({"score": 0.2 if weak else 0.9, "rationale": "mock"})

    return MockModelTarget("judge", responder=responder)


def test_matrix_shape_and_ranking():
    strong = MockModelTarget(
        "strong", responder=lambda c: c.reference, input_tokens=100, output_tokens=40, latency_ms=10.0
    )
    weak = MockModelTarget(
        "weak", responder=lambda c: "not sure", input_tokens=100, output_tokens=5, latency_ms=20.0
    )
    pricing = {"strong": (10.0, 30.0), "weak": (10.0, 30.0)}

    scores = run_matrix(_cases(), [strong, weak], judge=_judge(), pricing=pricing)
    assert len(scores) == 4  # 2 models x 2 cases

    cards = scorecards(scores)
    assert [c.model for c in cards] == ["strong", "weak"]  # ranked by quality desc
    assert cards[0].avg_quality == 0.9
    assert cards[1].avg_quality == 0.2

    # Deterministic success is "did it answer + pass any checks", not quality.
    # strong: q1 (no checks, answered) pass, q2 (contains 'two') pass -> 1.0
    # weak:   q1 (no checks, answered "not sure") pass, q2 (no 'two') fail -> 0.5
    assert cards[0].success_rate == 1.0
    assert cards[1].success_rate == 0.5


def test_matrix_cost_and_tokens():
    strong = MockModelTarget("m", responder=lambda c: c.reference, input_tokens=1_000_000, output_tokens=0)
    pricing = {"m": (2.0, 9.0)}
    scores = run_matrix([_cases()[0]], [strong], judge=_judge(), pricing=pricing)
    # 1e6 input tokens at $2/Mtok = $2.00 exactly.
    assert scores[0].cost_usd == 2.0
    assert scores[0].input_tokens == 1_000_000


def test_percentile():
    assert percentile([], 50) == 0.0
    assert percentile([5], 95) == 5
    assert percentile([10, 20, 30, 40], 50) == 25.0
    assert percentile([10, 20, 30, 40], 0) == 10
    assert percentile([10, 20, 30, 40], 100) == 40


def test_error_counts_surface_in_scorecard():
    boom = MockModelTarget("boom", ok=False, error="throttled")
    scores = run_matrix(_cases(), [boom], judge=_judge(), pricing={})
    cards = scorecards(scores)
    assert cards[0].n_errors == 2
    assert cards[0].success_rate == 0.0
    assert cards[0].avg_quality == 0.0


def test_leaderboard_markdown_renders():
    strong = MockModelTarget("strong", responder=lambda c: c.reference)
    cards = scorecards(run_matrix(_cases(), [strong], judge=_judge(), pricing={"strong": (1.0, 1.0)}))
    md = format_leaderboard(cards, suite="gen-smoke")
    assert "| rank | model |" in md
    assert "`strong`" in md
    assert "gen-smoke" in md
