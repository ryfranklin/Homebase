# stacks/retrieval

The retrieval core: a Bedrock Knowledge Base backed by S3 Vectors, ingesting from the corpus bucket
(P4). It stores its state remotely in the bootstrap bucket.

## What it creates

- An S3 Vectors vector bucket and index (KMS-encrypted, dimension matched to the embedding model).
- An IAM service role Bedrock assumes to read the corpus, invoke the embeddings model, and write
  vectors.
- A Bedrock Knowledge Base (`storage_configuration type = S3_VECTORS`) and an S3 data source pointed
  at the corpus bucket.
- SSM `String` parameters for the KB id, data source id, rerank model id, default search type, and
  embedding model id, so the ingestion trigger, eval harness, and agent can discover them.

## Provider version

This stack requires `hashicorp/aws >= 6.27.0` for the S3 Vectors storage configuration and the
`aws_s3vectors_*` resources. The other stacks pin 5.x; this one intentionally needs 6.x. Each stack
initializes independently, so the mixed major versions do not conflict.

## Capabilities: what is and is not supported here

S3 Vectors is semantic-only. Hybrid (dense plus keyword) search is NOT available on this path;
`HYBRID` silently degrades to semantic. Rerank IS available (query-time, store-independent) and its
model id is a variable exported to SSM. The hybrid-capable fallback is OpenSearch Serverless
(ADR-002), left as a marked seam in `variables.tf` and documented in `../../../docs/retrieval.md`.
Embedding and rerank model ids are variables, so Titan v2 vs Cohere is a config change, not a code
change.

## Initialize and validate (human runs apply, agents do not)

```bash
cp backend.hcl.example backend.hcl             # edit with bootstrap outputs
cp terraform.tfvars.example terraform.tfvars   # edit with real values
terraform -chdir=infra/stacks/retrieval init -backend-config=backend.hcl
terraform -chdir=infra/stacks/retrieval plan
```

Agents may run `fmt`, `validate`, and `plan` only. A human runs `apply`.
