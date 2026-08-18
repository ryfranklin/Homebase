"""Offline tests for the generation scorers. No AWS.

unittest.TestCase style so `python -m unittest discover` (what CI runs) executes
them, matching the existing retrieval tests.
"""

from __future__ import annotations

import json
import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_eval.gen_models import GenCase, ModelResponse
from homebase_eval.pricing import cost_usd, is_priced
from homebase_eval.scorers import score_cost, score_quality, score_success
from homebase_eval.targets import MockModelTarget


def _resp(text, ok=True, input_tokens=100, output_tokens=50):
    return ModelResponse(text=text, ok=ok, input_tokens=input_tokens, output_tokens=output_tokens)


class SuccessScorerTests(unittest.TestCase):
    def test_no_checks_passes_when_answer_present(self):
        case = GenCase(id="c", prompt="anything")
        self.assertTrue(score_success(case, _resp("some answer")))

    def test_failed_call_is_miss(self):
        case = GenCase(id="c", prompt="anything")
        self.assertFalse(score_success(case, ModelResponse(text="", ok=False, error="throttled")))

    def test_contains_all_required(self):
        case = GenCase(id="c", prompt="p", expect_contains=["def is_even", "return"])
        self.assertTrue(score_success(case, _resp("def is_even(n):\n    return n % 2 == 0")))
        self.assertFalse(score_success(case, _resp("def is_odd(n): pass")))

    def test_regex(self):
        case = GenCase(id="c", prompt="p", expect_regex=r"3:45")
        self.assertTrue(score_success(case, _resp("It arrives at 3:45 PM")))
        self.assertFalse(score_success(case, _resp("It arrives at 4:00 PM")))

    def test_json_and_keys(self):
        case = GenCase(id="c", prompt="p", expect_json=True, expect_json_keys=["name", "city"])
        self.assertTrue(score_success(case, _resp('{"name": "Ada", "city": "Turin"}')))
        self.assertFalse(score_success(case, _resp('{"name": "Ada"}')))
        self.assertFalse(score_success(case, _resp("not json")))

    def test_json_tolerates_fenced_block(self):
        case = GenCase(id="c", prompt="p", expect_json=True, expect_json_keys=["name"])
        fenced = "```json\n{\"name\": \"Ada\"}\n```"
        self.assertTrue(score_success(case, _resp(fenced)))


class CostScorerTests(unittest.TestCase):
    def test_cost_from_pricing_table(self):
        pricing = {"m": (15.0, 75.0)}
        expected = (100 / 1_000_000) * 15.0 + (50 / 1_000_000) * 75.0
        self.assertEqual(cost_usd("m", 100, 50, pricing), expected)
        self.assertEqual(score_cost(_resp("x"), "m", pricing), expected)

    def test_unknown_model_is_zero_and_flagged(self):
        pricing = {"m": (1.0, 1.0)}
        self.assertEqual(cost_usd("other", 100, 50, pricing), 0.0)
        self.assertFalse(is_priced("other", pricing))
        self.assertTrue(is_priced("m", pricing))


class QualityScorerTests(unittest.TestCase):
    def test_uses_judge_and_parses_json(self):
        case = GenCase(id="c", prompt="p")
        judge = MockModelTarget("judge", responder=lambda jc: json.dumps({"score": 0.8, "rationale": "good"}))
        score, rationale = score_quality(case, _resp("an answer"), judge)
        self.assertEqual(score, 0.8)
        self.assertEqual(rationale, "good")

    def test_zero_when_no_answer_without_calling_judge(self):
        case = GenCase(id="c", prompt="p")
        calls = {"n": 0}

        class CountingJudge:
            model_id = "judge"

            def generate(self, _case):
                calls["n"] += 1
                return ModelResponse(text='{"score": 1.0}')

        score, _ = score_quality(case, ModelResponse(text="", ok=False, error="boom"), CountingJudge())
        self.assertEqual(score, 0.0)
        self.assertEqual(calls["n"], 0)

    def test_clamps_and_falls_back_to_bare_number(self):
        case = GenCase(id="c", prompt="p")
        judge = MockModelTarget("judge", responder=lambda jc: "the score is 0.6 out of 1")
        score, _ = score_quality(case, _resp("x"), judge)
        self.assertEqual(score, 0.6)


if __name__ == "__main__":
    unittest.main()
