import pathlib
import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_eval.cli import main
from homebase_eval.gate import evaluate_gate
from homebase_eval.models import Case, load_cases
from homebase_eval.retrievers import FixtureRetriever

FIXTURES = pathlib.Path(__file__).resolve().parents[1] / "fixtures" / "cases.json"


class GateTests(unittest.TestCase):
    def test_clean_fixtures_pass_the_gate_green(self):
        result = evaluate_gate(load_cases(FIXTURES), FixtureRetriever(), k=3)
        self.assertTrue(result.passed, f"expected PASS, got: {result.reasons}")
        self.assertEqual(result.reasons, [])

    def test_seeded_regression_fails_the_gate_red(self):
        # Degraded rankings: the expected source is never near the top, so
        # reranked hit_rate collapses below the floor. A gate never shown to fail
        # is not a gate.
        degraded = [
            Case(
                id=f"c{i}",
                question=f"q{i}",
                expected_sources=["target.md"],
                offline_base=["noise1.md", "noise2.md", "noise3.md", "target.md"],
                offline_reranked=["noise1.md", "noise2.md", "noise3.md", "target.md"],
            )
            for i in range(8)
        ]
        result = evaluate_gate(degraded, FixtureRetriever(), k=3)
        self.assertFalse(result.passed)
        self.assertTrue(any("hit_rate" in r for r in result.reasons))

    def test_cli_gate_returns_zero_on_clean_fixtures(self):
        self.assertEqual(main(["--gate", "--k", "3"]), 0)


if __name__ == "__main__":
    unittest.main()
