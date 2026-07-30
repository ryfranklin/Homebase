"""Eval CLI: print a retrieval scorecard.

Offline mode (default) scores the committed synthetic fixtures with no AWS
calls. Live mode queries a deployed Bedrock Knowledge Base; it needs boto3, a
knowledge base id, and (for rerank) a rerank model ARN.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .models import load_cases
from .retrievers import FixtureRetriever
from .runner import format_scorecard, score

DEFAULT_CASES = str(Path(__file__).resolve().parents[2] / "fixtures" / "cases.json")


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="homebase-eval",
        description="Score retrieval quality (hit rate, MRR) with rerank on vs off.",
    )
    parser.add_argument("--cases", default=DEFAULT_CASES, help="Path to cases JSON.")
    parser.add_argument("--k", type=int, default=3, help="Cutoff k for hit_rate@k.")
    parser.add_argument(
        "--mode",
        choices=["offline", "live"],
        default="offline",
        help="offline scores committed fixtures; live queries a deployed KB.",
    )
    # Live-only options.
    parser.add_argument("--knowledge-base-id", default=os.environ.get("HOMEBASE_KB_ID"))
    parser.add_argument("--rerank-model-arn", default=os.environ.get("HOMEBASE_RERANK_MODEL_ARN"))
    parser.add_argument("--region", default=os.environ.get("AWS_REGION"))
    parser.add_argument("--num-results", type=int, default=10)
    return parser


def _build_retriever(args):
    if args.mode == "offline":
        return FixtureRetriever()

    if not args.knowledge_base_id:
        raise SystemExit("live mode needs --knowledge-base-id (or $HOMEBASE_KB_ID)")

    # Imported lazily so offline mode and the unit tests need no boto3.
    import boto3

    from .retrievers import BedrockKBRetriever

    client = (
        boto3.client("bedrock-agent-runtime", region_name=args.region)
        if args.region
        else boto3.client("bedrock-agent-runtime")
    )
    return BedrockKBRetriever(
        client,
        args.knowledge_base_id,
        rerank_model_arn=args.rerank_model_arn,
        num_results=args.num_results,
    )


def main(argv=None) -> int:
    args = build_arg_parser().parse_args(argv)
    cases = load_cases(args.cases)
    retriever = _build_retriever(args)
    scorecard = score(cases, retriever, args.k, mode=args.mode)
    print(format_scorecard(scorecard))
    return 0


if __name__ == "__main__":
    sys.exit(main())
