"""Offline tests for the multi-model matrix and leaderboard. No AWS.
unittest.TestCase style for CI's discover."""

from __future__ import annotations

import json
import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_eval.gen_models import GenCase
from homebase_eval.matrix import format_leaderboard, percentile, run_matrix, scorecards
from homebase_eval.targets import MockModelTarget


def _cases():
    return [
        GenCase(id="q1", prompt="p1", reference="answer one"),
        GenCase(id="q2", prompt="p2", reference="answer two", expect_contains=["two"]),
    ]


def _judge():
    def responder(jc):
        weak = "not sure" in jc.prompt.lower()
        return json.dumps({"score": 0.2 if weak else 0.9, "rationale": "mock"})

    return MockModelTarget("judge", responder=responder)


class MatrixTests(unittest.TestCase):
    def test_shape_and_ranking(self):
        strong = MockModelTarget(
            "strong", responder=lambda c: c.reference, input_tokens=100, output_tokens=40, latency_ms=10.0
        )
        weak = MockModelTarget(
            "weak", responder=lambda c: "not sure", input_tokens=100, output_tokens=5, latency_ms=20.0
        )
        pricing = {"strong": (10.0, 30.0), "weak": (10.0, 30.0)}

        scores = run_matrix(_cases(), [strong, weak], judge=_judge(), pricing=pricing)
        self.assertEqual(len(scores), 4)

        cards = scorecards(scores)
        self.assertEqual([c.model for c in cards], ["strong", "weak"])
        self.assertEqual(cards[0].avg_quality, 0.9)
        self.assertEqual(cards[1].avg_quality, 0.2)
        # Deterministic success is "answered + passed checks", not quality.
        self.assertEqual(cards[0].success_rate, 1.0)
        self.assertEqual(cards[1].success_rate, 0.5)

    def test_cost_and_tokens(self):
        strong = MockModelTarget("m", responder=lambda c: c.reference, input_tokens=1_000_000, output_tokens=0)
        pricing = {"m": (2.0, 9.0)}
        scores = run_matrix([_cases()[0]], [strong], judge=_judge(), pricing=pricing)
        self.assertEqual(scores[0].cost_usd, 2.0)
        self.assertEqual(scores[0].input_tokens, 1_000_000)

    def test_error_counts_surface(self):
        boom = MockModelTarget("boom", ok=False, error="throttled")
        cards = scorecards(run_matrix(_cases(), [boom], judge=_judge(), pricing={}))
        self.assertEqual(cards[0].n_errors, 2)
        self.assertEqual(cards[0].success_rate, 0.0)
        self.assertEqual(cards[0].avg_quality, 0.0)

    def test_leaderboard_markdown_renders(self):
        strong = MockModelTarget("strong", responder=lambda c: c.reference)
        cards = scorecards(run_matrix(_cases(), [strong], judge=_judge(), pricing={"strong": (1.0, 1.0)}))
        md = format_leaderboard(cards, suite="gen-smoke")
        self.assertIn("| rank | model |", md)
        self.assertIn("`strong`", md)
        self.assertIn("gen-smoke", md)


class PercentileTests(unittest.TestCase):
    def test_percentile(self):
        self.assertEqual(percentile([], 50), 0.0)
        self.assertEqual(percentile([5], 95), 5)
        self.assertEqual(percentile([10, 20, 30, 40], 50), 25.0)
        self.assertEqual(percentile([10, 20, 30, 40], 0), 10)
        self.assertEqual(percentile([10, 20, 30, 40], 100), 40)


if __name__ == "__main__":
    unittest.main()
