"""Command line entry point for the corpus sync.

The source path and bucket are runtime inputs only: a CLI flag or an environment
variable. There is no default path; the repository never learns where the
knowledge base lives.
"""

from __future__ import annotations

import argparse
import os
import sys

from .sync import sync_directory
from .trigger import should_trigger

SOURCE_ENV = "HOMEBASE_CORPUS_SOURCE_DIR"
BUCKET_ENV = "HOMEBASE_CORPUS_BUCKET"
PREFIX_ENV = "HOMEBASE_CORPUS_KEY_PREFIX"


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="homebase-ingest",
        description="Mirror a local Markdown corpus into the Homebase source S3 bucket.",
    )
    parser.add_argument(
        "--source",
        default=os.environ.get(SOURCE_ENV),
        help=f"Local Markdown directory to mirror. Defaults to ${SOURCE_ENV}.",
    )
    parser.add_argument(
        "--bucket",
        default=os.environ.get(BUCKET_ENV),
        help=f"Destination S3 bucket. Defaults to ${BUCKET_ENV}.",
    )
    parser.add_argument(
        "--key-prefix",
        default=os.environ.get(PREFIX_ENV, ""),
        help=f"Optional key prefix for uploaded objects. Defaults to ${PREFIX_ENV}.",
    )
    parser.add_argument(
        "--prune",
        action="store_true",
        help="Delete objects under the prefix that no longer exist locally.",
    )
    parser.add_argument(
        "--region",
        default=os.environ.get("AWS_REGION"),
        help="AWS region. Defaults to $AWS_REGION or the ambient AWS config.",
    )
    return parser


def main(argv=None) -> int:
    args = build_arg_parser().parse_args(argv)

    if not args.source:
        print(f"error: no source directory (pass --source or set ${SOURCE_ENV})", file=sys.stderr)
        return 2
    if not args.bucket:
        print(f"error: no destination bucket (pass --bucket or set ${BUCKET_ENV})", file=sys.stderr)
        return 2

    # Import boto3 lazily so importing this module (and running tests) needs no
    # AWS SDK and makes no AWS calls.
    import boto3

    s3_client = boto3.client("s3", region_name=args.region) if args.region else boto3.client("s3")

    result = sync_directory(
        s3_client,
        args.bucket,
        args.source,
        key_prefix=args.key_prefix,
        prune=args.prune,
    )

    print(
        f"uploaded={len(result.uploaded)} skipped={len(result.skipped)} "
        f"pruned={len(result.pruned)} sidecars={len(result.sidecars)}"
    )

    if should_trigger(result):
        # P5 wires the real Bedrock trigger here. For now, just report.
        print("corpus changed: a knowledge base ingestion job should be started (wired in P5)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
