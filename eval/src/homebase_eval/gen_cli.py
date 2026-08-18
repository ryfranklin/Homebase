"""CLI for the multi-model generation eval: run one suite across many models.

Offline mode (default) runs deterministic MockModelTargets and a mock judge, so
it needs no AWS and is safe in CI. Live mode drives real Bedrock models over the
Converse API; it needs boto3, credentials (instance role or profile), and a
region, and it spends tokens.

    # offline demo (no AWS): two mock models on the synthetic suite
    homebase-eval-models

    # live: compare real Bedrock models, judged by Opus
    homebase-eval-models --mode live \\
      --models us.anthropic.claude-opus-4-8,zai.glm-5,moonshotai.kimi-k2.5,qwen.qwen3-coder-next \\
      --judge us.anthropic.claude-opus-4-8 --region us-east-1
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .gen_models import load_gen_cases
from .matrix import format_leaderboard, format_tag_breakdown, run_matrix, scorecards, tag_breakdown
from .pricing import is_priced, load_pricing
from .targets import MockModelTarget

DEFAULT_CASES = str(Path(__file__).resolve().parents[2] / "fixtures" / "gen_cases.json")
DEFAULT_OFFLINE_MODELS = ["mock-strong", "mock-weak"]


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="homebase-eval-models",
        description="Run one task suite across many Bedrock models and score quality, latency, cost, and success.",
    )
    parser.add_argument("--cases", default=DEFAULT_CASES, help="Path to the generation cases JSON.")
    parser.add_argument(
        "--mode",
        choices=["offline", "live"],
        default="offline",
        help="offline runs deterministic mocks (no AWS); live drives real Bedrock models.",
    )
    parser.add_argument(
        "--models",
        default="",
        help="Comma-separated model ids / inference profiles. Live mode requires this.",
    )
    parser.add_argument(
        "--judge",
        default=os.environ.get("HOMEBASE_EVAL_JUDGE", ""),
        help="Model id used as the LLM judge. Live mode requires this.",
    )
    parser.add_argument("--region", default=os.environ.get("AWS_REGION"))
    parser.add_argument("--repeats", type=int, default=1, help="Calls per (model, case); metrics averaged.")
    parser.add_argument("--max-tokens", type=int, default=1024)
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--pricing", default=None, help="Override pricing table JSON.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON instead of the table.")
    parser.add_argument("--by-tag", action="store_true", help="Also print a per-capability (tag) quality breakdown.")
    parser.add_argument(
        "--min-quality",
        type=float,
        default=None,
        help="Gate: exit non-zero if the best model's avg quality is below this floor.",
    )
    return parser


def _build_live(args):
    """Build live Bedrock targets + judge. boto3 imported lazily (offline needs none)."""
    if not args.models:
        raise SystemExit("live mode needs --models (comma-separated Bedrock model ids)")
    if not args.judge:
        raise SystemExit("live mode needs --judge (a model id to score answers)")

    import boto3

    from .targets import BedrockConverseTarget

    client = (
        boto3.client("bedrock-runtime", region_name=args.region)
        if args.region
        else boto3.client("bedrock-runtime")
    )
    targets = [
        BedrockConverseTarget(client, m.strip(), max_tokens=args.max_tokens, temperature=args.temperature)
        for m in args.models.split(",")
        if m.strip()
    ]
    judge = BedrockConverseTarget(client, args.judge, max_tokens=256, temperature=0.0)
    return targets, judge


def _build_offline(args):
    """Deterministic mocks: a 'strong' model that echoes the reference (judge-friendly)
    and a 'weak' model that stalls. Judge is a mock that rewards reference overlap."""
    model_ids = [m.strip() for m in args.models.split(",") if m.strip()] or DEFAULT_OFFLINE_MODELS

    def strong(case):
        return case.reference or f"A complete answer to: {case.prompt}"

    def weak(_case):
        return "I am not sure."

    targets = []
    for i, model_id in enumerate(model_ids):
        responder = strong if i == 0 else weak
        targets.append(MockModelTarget(model_id, responder=responder, latency_ms=10.0 + i * 5))

    def judge_responder(judge_case):
        # Reward answers that are not the hedge; deterministic and AWS-free.
        looks_weak = "not sure" in judge_case.prompt.lower().split("candidate:")[-1]
        score = 0.2 if looks_weak else 0.9
        return json.dumps({"score": score, "rationale": "offline mock judge"})

    judge = MockModelTarget("mock-judge", responder=judge_responder)
    return targets, judge


def main(argv=None) -> int:
    args = build_arg_parser().parse_args(argv)
    cases = load_gen_cases(args.cases)
    pricing = load_pricing(args.pricing)

    if args.mode == "live":
        targets, judge = _build_live(args)
    else:
        targets, judge = _build_offline(args)

    unpriced = [t.model_id for t in targets if not is_priced(t.model_id, pricing)]
    scores = run_matrix(cases, targets, judge=judge, pricing=pricing, repeats=args.repeats)
    cards = scorecards(scores)

    suite_name = Path(args.cases).stem
    if args.json:
        print(json.dumps({"suite": suite_name, "scorecards": [c.__dict__ for c in cards]}, indent=2))
    else:
        print(format_leaderboard(cards, suite=suite_name))
        if args.by_tag:
            print()
            print(format_tag_breakdown(tag_breakdown(cases, scores)))
        if unpriced:
            print(f"\nNote: no pricing entry for {', '.join(unpriced)} (cost shown as $0). Add them to the pricing table.")

    if args.min_quality is not None:
        best = cards[0].avg_quality if cards else 0.0
        if best < args.min_quality:
            print(f"\nGATE: FAIL (best avg quality {best:.3f} < floor {args.min_quality:.3f})")
            return 1
        print(f"\nGATE: PASS (best avg quality {best:.3f} >= floor {args.min_quality:.3f})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
