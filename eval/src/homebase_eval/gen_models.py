"""Data models for the generation (multi-model) eval layer.

This layer runs one task suite across many Bedrock models and scores each on
quality (LLM judge), latency, cost, and task success. It mirrors the retrieval
layer's shape (see models.py): plain frozen dataclasses, no AWS imports here.

Every record carries tenant_id and user_id. Homebase is the single-tenant seed
of a multi-tenant platform, so identity is explicit in the data model even while
only one tenant exists.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class GenCase:
    """A single generation task: a prompt plus how to judge the answer.

    Success checks are deterministic and cheap (no model call). The rubric drives
    the LLM judge. A case may use any subset: leave a check empty to skip it.
    """

    id: str
    prompt: str
    system: str = ""
    reference: str = ""  # optional gold answer the judge may compare against
    # Deterministic success checks (all that are set must pass):
    expect_contains: list = field(default_factory=list)  # substrings, case-insensitive
    expect_regex: str = ""  # answer must match this pattern (re.search)
    expect_json: bool = False  # answer must parse as JSON
    expect_json_keys: list = field(default_factory=list)  # top-level keys JSON must have
    # Judge config:
    rubric: str = ""  # per-case rubric; falls back to the suite default
    tags: list = field(default_factory=list)
    # Multi-tenant seed (see module docstring):
    tenant_id: str = "homebase"
    user_id: str = "system"


@dataclass(frozen=True)
class ModelResponse:
    """The raw output of one model on one case, with usage and wall-clock latency.

    ok is False when the model call itself failed (throttling, access denied, a
    malformed response); error carries the reason. A failed call scores as a hard
    miss (success=False, quality=0) rather than crashing the matrix.
    """

    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: float = 0.0
    ok: bool = True
    error: str = ""


@dataclass(frozen=True)
class CaseScore:
    """The full scoring of one (model, case) pair across all four metrics."""

    case_id: str
    model: str
    quality: float  # 0.0 .. 1.0 from the judge
    quality_rationale: str
    latency_ms: float
    cost_usd: float
    success: bool  # deterministic checks all passed
    input_tokens: int
    output_tokens: int
    tenant_id: str = "homebase"
    user_id: str = "system"
    error: str = ""


@dataclass(frozen=True)
class ModelScorecard:
    """Per-model aggregate across a suite: the row of the leaderboard."""

    model: str
    n_cases: int
    avg_quality: float
    p50_latency_ms: float
    p95_latency_ms: float
    avg_cost_usd: float
    total_cost_usd: float
    success_rate: float
    n_errors: int


def load_gen_cases(path) -> list:
    """Load generation cases from a JSON file.

    Schema (see fixtures/gen_cases.json):
        {"suite": "...", "default_rubric": "...", "cases": [ {GenCase fields...} ]}
    """
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    default_rubric = raw.get("default_rubric", "")
    cases = []
    for item in raw["cases"]:
        cases.append(
            GenCase(
                id=item["id"],
                prompt=item["prompt"],
                system=item.get("system", ""),
                reference=item.get("reference", ""),
                expect_contains=list(item.get("expect_contains", [])),
                expect_regex=item.get("expect_regex", ""),
                expect_json=bool(item.get("expect_json", False)),
                expect_json_keys=list(item.get("expect_json_keys", [])),
                rubric=item.get("rubric", "") or default_rubric,
                tags=list(item.get("tags", [])),
                tenant_id=item.get("tenant_id", "homebase"),
                user_id=item.get("user_id", "system"),
            )
        )
    return cases
