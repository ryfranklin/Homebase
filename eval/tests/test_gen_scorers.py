"""Offline tests for the generation scorers. No AWS."""

from __future__ import annotations

import json

from homebase_eval.gen_models import GenCase, ModelResponse
from homebase_eval.pricing import cost_usd, is_priced
from homebase_eval.scorers import score_cost, score_quality, score_success
from homebase_eval.targets import MockModelTarget


def _resp(text, ok=True, input_tokens=100, output_tokens=50):
    return ModelResponse(text=text, ok=ok, input_tokens=input_tokens, output_tokens=output_tokens)


def test_success_no_checks_passes_when_answer_present():
    case = GenCase(id="c", prompt="anything")
    assert score_success(case, _resp("some answer")) is True


def test_success_failed_call_is_miss():
    case = GenCase(id="c", prompt="anything")
    assert score_success(case, ModelResponse(text="", ok=False, error="throttled")) is False


def test_success_contains_all_required():
    case = GenCase(id="c", prompt="p", expect_contains=["def is_even", "return"])
    assert score_success(case, _resp("def is_even(n):\n    return n % 2 == 0")) is True
    assert score_success(case, _resp("def is_odd(n): pass")) is False


def test_success_regex():
    case = GenCase(id="c", prompt="p", expect_regex=r"3:45")
    assert score_success(case, _resp("It arrives at 3:45 PM")) is True
    assert score_success(case, _resp("It arrives at 4:00 PM")) is False


def test_success_json_and_keys():
    case = GenCase(id="c", prompt="p", expect_json=True, expect_json_keys=["name", "city"])
    assert score_success(case, _resp('{"name": "Ada", "city": "Turin"}')) is True
    assert score_success(case, _resp('{"name": "Ada"}')) is False
    assert score_success(case, _resp("not json")) is False


def test_success_json_tolerates_fenced_block():
    case = GenCase(id="c", prompt="p", expect_json=True, expect_json_keys=["name"])
    fenced = "```json\n{\"name\": \"Ada\"}\n```"
    assert score_success(case, _resp(fenced)) is True


def test_cost_from_pricing_table():
    pricing = {"m": (15.0, 75.0)}
    # 100 input tokens at $15/Mtok + 50 output at $75/Mtok
    expected = (100 / 1_000_000) * 15.0 + (50 / 1_000_000) * 75.0
    assert cost_usd("m", 100, 50, pricing) == expected
    assert score_cost(_resp("x"), "m", pricing) == expected


def test_cost_unknown_model_is_zero_and_flagged():
    pricing = {"m": (1.0, 1.0)}
    assert cost_usd("other", 100, 50, pricing) == 0.0
    assert is_priced("other", pricing) is False
    assert is_priced("m", pricing) is True


def test_quality_uses_judge_and_parses_json():
    case = GenCase(id="c", prompt="p")
    judge = MockModelTarget(
        "judge",
        responder=lambda jc: json.dumps({"score": 0.8, "rationale": "good"}),
    )
    score, rationale = score_quality(case, _resp("an answer"), judge)
    assert score == 0.8
    assert rationale == "good"


def test_quality_zero_when_no_answer_without_calling_judge():
    case = GenCase(id="c", prompt="p")
    calls = {"n": 0}

    class CountingJudge:
        model_id = "judge"

        def generate(self, _case):
            calls["n"] += 1
            return ModelResponse(text='{"score": 1.0}')

    score, _ = score_quality(case, ModelResponse(text="", ok=False, error="boom"), CountingJudge())
    assert score == 0.0
    assert calls["n"] == 0  # judge not spent on a failed candidate


def test_quality_clamps_and_falls_back_to_bare_number():
    case = GenCase(id="c", prompt="p")
    judge = MockModelTarget("judge", responder=lambda jc: "the score is 0.6 out of 1")
    score, _ = score_quality(case, _resp("x"), judge)
    assert score == 0.6
