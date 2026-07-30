import pathlib
import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_eval.models import Case, load_cases
from homebase_eval.retrievers import FixtureRetriever
from homebase_eval.runner import format_scorecard, score

FIXTURES = pathlib.Path(__file__).resolve().parents[1] / "fixtures" / "cases.json"


class RunnerTests(unittest.TestCase):
    def test_scores_committed_fixtures_offline(self):
        cases = load_cases(FIXTURES)
        self.assertEqual(len(cases), 8)

        scorecard = score(cases, FixtureRetriever(), k=3)

        self.assertEqual(scorecard.n_cases, 8)
        # Rerank must show a positive lift on these fixtures.
        self.assertGreater(scorecard.reranked_hit_rate, scorecard.base_hit_rate)
        self.assertGreater(scorecard.reranked_mrr, scorecard.base_mrr)
        self.assertAlmostEqual(scorecard.base_hit_rate, 0.625)
        self.assertAlmostEqual(scorecard.reranked_hit_rate, 1.0)
        self.assertGreater(scorecard.hit_rate_lift, 0.0)

    def test_rerank_lift_can_be_zero_or_negative(self):
        # A case where rerank does not help: identical rankings.
        cases = [
            Case(
                id="x",
                question="q",
                expected_sources=["target.md"],
                offline_base=["target.md", "other.md"],
                offline_reranked=["target.md", "other.md"],
            )
        ]
        scorecard = score(cases, FixtureRetriever(), k=1)
        self.assertEqual(scorecard.hit_rate_lift, 0.0)
        self.assertEqual(scorecard.mrr_lift, 0.0)

    def test_format_scorecard_reports_both_columns_and_lift(self):
        cases = load_cases(FIXTURES)
        text = format_scorecard(score(cases, FixtureRetriever(), k=3))
        self.assertIn("base", text)
        self.assertIn("rerank", text)
        self.assertIn("lift", text)
        self.assertIn("hit_rate@3", text)


if __name__ == "__main__":
    unittest.main()
