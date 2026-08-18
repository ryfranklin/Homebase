"""Cost model for the generation eval.

Pricing is expressed as US dollars per 1,000,000 tokens, as (input, output).

These numbers are an INPUT, not a fact frozen in code: Bedrock prices change and
vary by region. The committed table in fixtures/pricing.json holds reasonable
placeholders so the harness runs out of the box; confirm the current on-demand
Bedrock price for your region before trusting the cost column, and override with
``--pricing your.json`` (or the PRICING SSM parameter in the deployed stack).

An unknown model prices at 0.0 and is flagged by the caller, so a missing entry
shows up as "cost unknown" rather than a silent zero that looks free.
"""

from __future__ import annotations

import json
from pathlib import Path

DEFAULT_PRICING_PATH = str(Path(__file__).resolve().parents[2] / "fixtures" / "pricing.json")


def load_pricing(path=None) -> dict:
    """Load the pricing table {model_id: [input_per_mtok, output_per_mtok]}."""
    raw = json.loads(Path(path or DEFAULT_PRICING_PATH).read_text(encoding="utf-8"))
    return {model: (float(rate[0]), float(rate[1])) for model, rate in raw.get("pricing", {}).items()}


def cost_usd(model_id, input_tokens, output_tokens, pricing) -> float:
    """Cost of one call. Returns 0.0 when the model is not in the table."""
    rate = pricing.get(model_id)
    if not rate:
        return 0.0
    input_rate, output_rate = rate
    return (input_tokens / 1_000_000.0) * input_rate + (output_tokens / 1_000_000.0) * output_rate


def is_priced(model_id, pricing) -> bool:
    """Whether the model has an entry, so callers can flag unpriced models."""
    return model_id in pricing
