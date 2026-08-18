"""Container entrypoint for the deployed eval task: run one benchmark and persist.

Configuration comes from env vars (what the Fargate task definition injects) with
argparse overrides. The default path runs live Bedrock models and writes to
DynamoDB + S3 + CloudWatch (EMF). ``--dry-run`` runs the whole orchestration
offline with mock models and an in-memory sink, so the wiring is verifiable with
no AWS and no spend.

Env vars:
    EVAL_MODELS         comma-separated model ids / inference profiles
    EVAL_JUDGE          judge model id
    EVAL_TABLE          DynamoDB table name (live)
    EVAL_BUCKET         S3 artifacts bucket (live)
    EVAL_PRICING_SSM    SSM parameter name holding the pricing JSON (optional)
    EVAL_SUITE_S3       s3://bucket/key of the suite JSON (optional; else the baked fixture)
    EVAL_SUITE_PATH     local suite path (default: committed fixtures/gen_cases.json)
    EVAL_TENANT_ID      default "homebase"
    EVAL_USER_ID        default "system"
    EVAL_REPEATS        default 1
    GIT_SHA             image provenance, stored on the run
    AWS_REGION          region for all clients
"""

from __future__ import annotations

import argparse
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .batch import AwsSink, MemorySink, RunConfig, run_batch
from .gen_models import load_gen_cases
from .matrix import format_leaderboard
from .pricing import DEFAULT_PRICING_PATH, load_pricing, load_pricing_from_ssm

DEFAULT_SUITE = str(Path(__file__).resolve().parents[2] / "fixtures" / "gen_cases.json")


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="homebase-eval-batch",
        description="Run one multi-model benchmark and persist results (deployed eval task entrypoint).",
    )
    p.add_argument("--models", default=os.environ.get("EVAL_MODELS", ""))
    p.add_argument("--judge", default=os.environ.get("EVAL_JUDGE", ""))
    p.add_argument("--table", default=os.environ.get("EVAL_TABLE", ""))
    p.add_argument("--bucket", default=os.environ.get("EVAL_BUCKET", ""))
    p.add_argument("--pricing-ssm", default=os.environ.get("EVAL_PRICING_SSM", ""))
    p.add_argument("--suite-s3", default=os.environ.get("EVAL_SUITE_S3", ""))
    p.add_argument("--suite-path", default=os.environ.get("EVAL_SUITE_PATH", DEFAULT_SUITE))
    p.add_argument("--tenant-id", default=os.environ.get("EVAL_TENANT_ID", "homebase"))
    p.add_argument("--user-id", default=os.environ.get("EVAL_USER_ID", "system"))
    p.add_argument("--repeats", type=int, default=int(os.environ.get("EVAL_REPEATS", "1")))
    p.add_argument("--git-sha", default=os.environ.get("GIT_SHA", ""))
    p.add_argument("--region", default=os.environ.get("AWS_REGION"))
    p.add_argument("--dry-run", action="store_true", help="Run offline with mocks + in-memory sink (no AWS).")
    return p


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_run_id() -> str:
    return uuid.uuid4().hex[:12]


def _load_suite(args):
    if args.suite_s3:
        import boto3

        assert args.suite_s3.startswith("s3://"), "EVAL_SUITE_S3 must be an s3:// uri"
        bucket, _, key = args.suite_s3[len("s3://"):].partition("/")
        body = boto3.client("s3", region_name=args.region).get_object(Bucket=bucket, Key=key)["Body"].read()
        tmp = Path("/tmp/eval-suite.json")
        tmp.write_bytes(body)
        return load_gen_cases(tmp)
    return load_gen_cases(args.suite_path)


def _build_live_targets(args):
    import boto3

    from .targets import BedrockConverseTarget

    client = boto3.client("bedrock-runtime", region_name=args.region) if args.region else boto3.client("bedrock-runtime")
    targets = [BedrockConverseTarget(client, m.strip()) for m in args.models.split(",") if m.strip()]
    judge = BedrockConverseTarget(client, args.judge, max_tokens=256, temperature=0.0)
    return targets, judge


def _build_dry_targets(args):
    from .targets import MockModelTarget

    model_ids = [m.strip() for m in args.models.split(",") if m.strip()] or ["mock-a", "mock-b"]
    targets = [MockModelTarget(m, responder=(lambda c: c.reference or c.prompt)) for m in model_ids]
    judge = MockModelTarget("mock-judge", responder=lambda jc: '{"score": 0.9, "rationale": "dry-run"}')
    return targets, judge


def main(argv=None) -> int:
    args = build_arg_parser().parse_args(argv)

    config = RunConfig(
        run_id=_new_run_id(),
        suite=Path(args.suite_s3 or args.suite_path).name,
        models=[m.strip() for m in args.models.split(",") if m.strip()],
        judge=args.judge,
        created_at=_now_iso(),
        tenant_id=args.tenant_id,
        user_id=args.user_id,
        git_sha=args.git_sha,
        repeats=args.repeats,
    )
    cases = _load_suite(args)

    if args.dry_run:
        pricing = load_pricing(DEFAULT_PRICING_PATH)
        targets, judge = _build_dry_targets(args)
        sink = MemorySink()
    else:
        if not args.models or not args.judge:
            raise SystemExit("live run needs --models and --judge (or EVAL_MODELS / EVAL_JUDGE)")
        if not args.table or not args.bucket:
            raise SystemExit("live run needs --table and --bucket (or EVAL_TABLE / EVAL_BUCKET)")
        pricing = load_pricing_from_ssm(args.pricing_ssm, args.region) if args.pricing_ssm else load_pricing()
        targets, judge = _build_live_targets(args)
        sink = AwsSink(table_name=args.table, bucket=args.bucket, region=args.region)

    _scores, cards = run_batch(config, cases, targets, judge, pricing, sink)

    print(f"run_id={config.run_id} suite={config.suite} models={len(config.models)} cases={len(cases)}")
    print(format_leaderboard(cards, suite=config.suite))
    return 0


if __name__ == "__main__":
    sys.exit(main())
