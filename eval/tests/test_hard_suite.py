"""Tests for the hard suite and the per-capability breakdown. No AWS.
unittest.TestCase style for CI's discover."""

from __future__ import annotations

import unittest
from pathlib import Path

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_eval.gen_models import ModelResponse, load_gen_cases
from homebase_eval.matrix import format_tag_breakdown, run_matrix, scorecards, tag_breakdown
from homebase_eval.scorers import score_success
from homebase_eval.targets import MockModelTarget

HARD_SUITE = Path(__file__).resolve().parents[1] / "fixtures" / "gen_suite_hard.json"


def _breakdown_fixture():
    cases = load_gen_cases(HARD_SUITE)[:4]

    strong = MockModelTarget("strong", responder=lambda c: c.reference)
    weak = MockModelTarget("weak", responder=lambda c: "I do not know")

    def judge_responder(jc):
        weak_answer = "i do not know" in jc.prompt.lower()
        return '{"score": 0.2, "rationale": "x"}' if weak_answer else '{"score": 0.9, "rationale": "x"}'

    judge = MockModelTarget("judge", responder=judge_responder)
    scores = run_matrix(cases, [strong, weak], judge=judge, pricing={})
    return cases, scores


class HardSuiteTests(unittest.TestCase):
    def test_loads_and_is_tagged(self):
        cases = load_gen_cases(HARD_SUITE)
        self.assertGreaterEqual(len(cases), 20)
        self.assertTrue(all(c.tags for c in cases))
        self.assertTrue(all(c.reference for c in cases))

    def test_references_pass_their_own_checks(self):
        # A reference that fails its own deterministic checks is a suite bug: it
        # would mark the "correct" answer as a failure.
        for case in load_gen_cases(HARD_SUITE):
            resp = ModelResponse(text=case.reference, ok=True)
            self.assertTrue(score_success(case, resp), f"reference for {case.id} fails its own checks")


class TagBreakdownTests(unittest.TestCase):
    def test_groups_by_capability(self):
        cases, scores = _breakdown_fixture()
        by_tag = tag_breakdown(cases, scores)

        expected_tags = set()
        for c in cases:
            expected_tags.update(c.tags)
        self.assertEqual(set(by_tag.keys()), expected_tags)

        for tag, rows in by_tag.items():
            self.assertEqual(rows[0][0], "strong", tag)
            self.assertGreaterEqual(rows[0][1], rows[-1][1])

    def test_format_renders(self):
        cases, scores = _breakdown_fixture()
        md = format_tag_breakdown(tag_breakdown(cases, scores))
        self.assertIn("## By capability", md)
        self.assertIn("| model | quality | success | n |", md)

    def test_scorecards_still_aggregate(self):
        cases, scores = _breakdown_fixture()
        cards = scorecards(scores)
        self.assertEqual([c.model for c in cards], ["strong", "weak"])


if __name__ == "__main__":
    unittest.main()
