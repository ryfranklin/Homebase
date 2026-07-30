"""Command line entry point for the corpus sync.

The source path and bucket are runtime inputs only: a CLI flag or an environment
variable. There is no default path; the repository never learns where the
knowledge base lives.
"""

from __future__ import annotations

import argparse
import os
import sys

from .bedrock_trigger import BedrockIngestionTrigger, make_client_token
from .sync import sync_directory
from .trigger import IngestionTriggerRequest, should_trigger

SOURCE_ENV = "HOMEBASE_CORPUS_SOURCE_DIR"
BUCKET_ENV = "HOMEBASE_CORPUS_BUCKET"
PREFIX_ENV = "HOMEBASE_CORPUS_KEY_PREFIX"
KB_ID_ENV = "HOMEBASE_KB_ID"
DATA_SOURCE_ID_ENV = "HOMEBASE_KB_DATA_SOURCE_ID"


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
        "--knowledge-base-id",
        default=os.environ.get(KB_ID_ENV),
        help=f"Bedrock Knowledge Base id. Defaults to ${KB_ID_ENV}. When set with "
        "--data-source-id, a changed corpus starts an ingestion job.",
    )
    parser.add_argument(
        "--data-source-id",
        default=os.environ.get(DATA_SOURCE_ID_ENV),
        help=f"Bedrock data source id. Defaults to ${DATA_SOURCE_ID_ENV}.",
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
        if args.knowledge_base_id and args.data_source_id:
            bedrock = (
                boto3.client("bedrock-agent", region_name=args.region)
                if args.region
                else boto3.client("bedrock-agent")
            )
            changed = result.uploaded + result.pruned
            request = IngestionTriggerRequest(
                knowledge_base_id=args.knowledge_base_id,
                data_source_id=args.data_source_id,
                changed_count=len(changed),
                description="homebase corpus sync",
                client_token=make_client_token(changed),
            )
            # A failure raises IngestionJobError and exits non-zero, rather than
            # silently succeeding on a broken ingestion.
            response = BedrockIngestionTrigger(bedrock).start(request)
            print(f"started ingestion job {response.job_id} (status={response.detail})")
        else:
            print(
                "corpus changed: set --knowledge-base-id and --data-source-id "
                f"(or ${KB_ID_ENV} / ${DATA_SOURCE_ID_ENV}) to start a KB ingestion job"
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
