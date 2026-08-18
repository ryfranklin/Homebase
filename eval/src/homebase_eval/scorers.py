"""Scorers for the generation eval: quality, latency, cost, task success.

Each scorer is a small pure-ish function over a case and a ModelResponse. The
quality scorer is the only one that calls a model: it uses an LLM judge, which is
just another target (MockModelTarget offline, BedrockConverseTarget live), so the
judge model is a deliberate, swappable choice and the tests need no AWS.
"""

from __future__ import annotations

import json
import re

from .gen_models import GenCase, ModelResponse
from .pricing import cost_usd

DEFAULT_RUBRIC = (
    "Rate how well the answer satisfies the task. Consider correctness, "
    "completeness, and whether it follows the instructions. If a reference answer "
    "is given, judge agreement with it on substance, not wording."
)

_JUDGE_INSTRUCTION = (
    "You are a strict evaluation judge. Score the CANDIDATE answer against the "
    "TASK and RUBRIC. Reply with ONLY a JSON object of the form "
    '{{"score": <float 0..1>, "rationale": "<one sentence>"}}. '
    "1.0 is a perfect answer, 0.0 is useless or wrong. Do not add any text "
    "outside the JSON.\n\n"
    "RUBRIC:\n{rubric}\n\n"
    "TASK:\n{prompt}\n\n"
    "{reference_block}"
    "CANDIDATE:\n{candidate}\n"
)


# ---- deterministic metrics (no model call) --------------------------------


def score_latency(response: ModelResponse) -> float:
    """Wall-clock latency in milliseconds for the call."""
    return response.latency_ms


def score_cost(response: ModelResponse, model_id: str, pricing: dict) -> float:
    """Dollar cost of the call from token usage and the pricing table."""
    return cost_usd(model_id, response.input_tokens, response.output_tokens, pricing)


def score_success(case: GenCase, response: ModelResponse) -> bool:
    """Deterministic pass/fail: every configured check must pass.

    A failed model call (ok=False) is always a miss. With no checks configured, a
    successful call counts as a pass, so success reduces to "did it answer".
    """
    if not response.ok:
        return False

    text = response.text

    if case.expect_contains:
        low = text.lower()
        if not all(sub.lower() in low for sub in case.expect_contains):
            return False

    if case.expect_regex:
        if not re.search(case.expect_regex, text):
            return False

    if case.expect_json or case.expect_json_keys:
        parsed = _try_parse_json(text)
        if parsed is None:
            return False
        if case.expect_json_keys:
            if not isinstance(parsed, dict) or not all(k in parsed for k in case.expect_json_keys):
                return False

    return True


# ---- quality via an LLM judge ---------------------------------------------


def score_quality(case: GenCase, response: ModelResponse, judge) -> tuple:
    """Return (score 0..1, rationale) from the judge target.

    A failed candidate call scores 0.0 without spending a judge call. The judge
    reply is expected to be a JSON object; parsing is tolerant so a stray token
    around the JSON does not throw.
    """
    if not response.ok or not response.text:
        return 0.0, "no answer produced"

    rubric = case.rubric or DEFAULT_RUBRIC
    reference_block = f"REFERENCE:\n{case.reference}\n\n" if case.reference else ""
    prompt = _JUDGE_INSTRUCTION.format(
        rubric=rubric,
        prompt=case.prompt,
        reference_block=reference_block,
        candidate=response.text,
    )
    judge_case = GenCase(id=f"judge::{case.id}", prompt=prompt)
    verdict = judge.generate(judge_case)
    if not verdict.ok:
        return 0.0, f"judge failed: {verdict.error}"
    return _parse_verdict(verdict.text)


# ---- helpers --------------------------------------------------------------


def _try_parse_json(text):
    """Parse JSON, tolerating a fenced ```json block or surrounding prose."""
    text = text.strip()
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        pass
    match = re.search(r"\{.*\}|\[.*\]", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except (ValueError, TypeError):
            return None
    return None


def _parse_verdict(text) -> tuple:
    parsed = _try_parse_json(text)
    if isinstance(parsed, dict) and "score" in parsed:
        try:
            score = float(parsed["score"])
        except (ValueError, TypeError):
            return 0.0, "judge returned a non-numeric score"
        score = max(0.0, min(1.0, score))
        return score, str(parsed.get("rationale", ""))
    # Fall back to the first bare number in [0, 1] if the judge ignored the format.
    number = re.search(r"(?<![\d.])(0(?:\.\d+)?|1(?:\.0+)?)(?![\d.])", text or "")
    if number:
        return max(0.0, min(1.0, float(number.group(0)))), "parsed from non-JSON judge reply"
    return 0.0, "judge reply was not parseable"
