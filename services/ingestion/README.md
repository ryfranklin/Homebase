# services/ingestion

A small, testable tool that mirrors a local Markdown corpus into the Homebase source S3 bucket. It
is Markdown-aware: front matter keys and relative links become S3 object metadata, which P5's
retrieval filtering leans on.

## Path- and account-agnostic

The source directory and destination bucket are runtime inputs only, never committed:

- `--source` or `HOMEBASE_CORPUS_SOURCE_DIR`
- `--bucket` or `HOMEBASE_CORPUS_BUCKET`
- `--key-prefix` or `HOMEBASE_CORPUS_KEY_PREFIX` (optional)

There is no default path anywhere in this package. The repository never learns where your knowledge
base lives.

## What it does

- Walks the source directory for `*.md` and `*.markdown` files.
- Splits YAML-style front matter and extracts relative Markdown links.
- Uploads each file with its front matter and links as `x-amz-meta-*` metadata.
- Respects the S3 2 KB user-metadata limit: when front matter plus links would exceed the budget,
  the full set is spilled into a `<key>.metadata.json` sidecar object and the inline metadata
  records a pointer (`metadata-overflow=sidecar`, `sidecar-key=...`). Nothing is silently dropped.
- Skips objects whose stored content hash already matches (idempotent mirror).
- Optionally prunes objects that no longer exist locally (`--prune`).
- Bucket-default KMS encryption applies; the tool references no key id.

## Trigger contract and the real Bedrock trigger (P5)

After a sync that changed the corpus, the caller starts a Bedrock Knowledge Base ingestion job.
`trigger.py` defines the contract (`IngestionTrigger`, `IngestionTriggerRequest`,
`IngestionTriggerResponse`) with a `NullIngestionTrigger` default. `bedrock_trigger.py` is the real
implementation (`BedrockIngestionTrigger`): it calls `start_ingestion_job` on a `bedrock-agent`
client. It is:

- Idempotent: `make_client_token` derives a deterministic token from the changed object keys, so
  retrying the same sync reuses the token and Bedrock does not start a duplicate job.
- Fail-loud: a failed start raises `IngestionJobError` (the CLI exits non-zero) rather than silently
  succeeding on a broken ingestion.

The CLI wires it automatically: when `--knowledge-base-id` and `--data-source-id` (or `$HOMEBASE_KB_ID`
and `$HOMEBASE_KB_DATA_SOURCE_ID`) are set and the corpus changed, it starts a job. Resolve those ids
from SSM: `/homebase/<env>/retrieval/knowledge_base_id` and `.../data_source_id`.

## Usage

```bash
export HOMEBASE_CORPUS_SOURCE_DIR=/path/to/your/markdown   # your value, never committed
export HOMEBASE_CORPUS_BUCKET=your-corpus-bucket-name
python -m homebase_ingestion.cli --prune
```

## Tests

The unit tests run offline against a temporary fixture directory with a fake S3 client (no AWS
calls, no credentials):

```bash
cd services/ingestion
python -m unittest discover -s tests   # or: pytest
```
