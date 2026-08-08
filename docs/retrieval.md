# Retrieval core: S3 Vectors capability findings and design

This note records what was verified from AWS documentation before building the retrieval stack, so
the design rests on evidence, not hope. It is the input to ADR-002 (vector store choice).

## Question

Can we run hybrid retrieval (dense plus keyword) and Bedrock Rerank on a Bedrock Knowledge Base
whose vector store is Amazon S3 Vectors?

## Findings (verified against AWS docs, 2026)

1. S3 Vectors as a Bedrock KB vector store: SUPPORTED and GA. Bedrock manages embeddings and vector
   storage for you. Terraform wires it with
   `storage_configuration { type = "S3_VECTORS"  s3_vectors_configuration { vector_bucket_arn, index_name } }`,
   which requires `hashicorp/aws >= 6.27.0`. The vector bucket and index are real Terraform
   resources (`aws_s3vectors_vector_bucket`, `aws_s3vectors_index`).

2. Hybrid search on S3 Vectors: NOT SUPPORTED. AWS documents S3 Vectors as semantic-only:
   "S3 Vectors supports semantic search but not hybrid search capabilities." A `HYBRID` override
   against an S3 Vectors KB silently degrades to semantic. Hybrid is supported on OpenSearch
   Serverless, Aurora/RDS PostgreSQL, and MongoDB Atlas (stores with a filterable text field).

3. Bedrock Rerank on S3 Vectors: SUPPORTED. Reranking is a query-time step configured on the
   Retrieve / RetrieveAndGenerate API (`rerankingConfiguration`), independent of the vector store.
   S3 Vectors data is textual, so rerank applies. It is not part of the KB storage configuration and
   therefore not part of the retrieval Terraform stack; the rerank model id is a variable, recorded
   in SSM for the eval harness and agent.

   Caveat: AWS documents rerank as store-independent and documents S3 Vectors as textual, but there
   is no single sentence that says verbatim "rerank is supported with S3 Vectors." A smoke test in
   the target region is worthwhile.

4. Metadata limits on S3 Vectors: up to 1 KB custom metadata and 35 metadata keys per vector; some
   filter operators (for example `startsWith`) are not supported. This is why the ingestion tool
   (P4) spills large front matter into a sidecar rather than relying on unbounded object metadata.

Sources:
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-bedrock-kb.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-config.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/rerank.html
- https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent_StorageConfiguration.html
- https://github.com/hashicorp/terraform-provider-aws/pull/45468 (S3 Vectors storage config, provider v6.27.0)

## Decision and the marked seam (ADR-002)

We build on S3 Vectors with semantic retrieval plus query-time rerank, because it is the
cost-optimized path and rerank is available. We do NOT emit a hybrid configuration on S3 Vectors,
because it would not do what it says.

The seam for hybrid is explicit:
- `infra/stacks/retrieval/variables.tf` has `vector_store_type` (default `S3_VECTORS`) with a
  validation that only `S3_VECTORS` is implemented, and a pointer here.
- `default_search_type` defaults to `SEMANTIC`; `HYBRID` is only honored on a hybrid-capable store.
- If hybrid proves necessary, switch to the OpenSearch Serverless fallback (which supports HYBRID,
  rerank, and richer metadata filters). Because the S3 Vectors storage arguments are ForceNew, treat
  the vector store choice as a replacement-level decision.

## Live eval result and the decision (2026-08-08)

First live run against the real corpus (273 docs ingested into the S3 Vectors KB) using a private
22-case question -> expected-source set spanning all corpus areas (architecture ADRs, SQL Server
incidents/tickets, data-engineering, AWS/MWAA). Rerank model: `cohere.rerank-v3-5:0` (the model
available in us-east-1; `amazon.rerank-v1:0` is not). Metric: does the expected doc appear in the
top-k retrieved sources.

| k | base hit_rate (semantic-only) | reranked hit_rate | rerank lift |
| --- | --- | --- | --- |
| 1 | 0.727 | 0.955 | +0.227 |
| 3 | 0.955 | 1.000 | +0.045 |
| 5 | 1.000 | 1.000 | +0.000 |

MRR (all k): base 0.842 -> reranked 0.977 (+0.135).

**Decision: STAY on S3 Vectors (semantic + query-time rerank). The OpenSearch Serverless seam is NOT
triggered.** Reranked `hit_rate@5` = 1.000 and `hit_rate@3` = 1.000, far above the 0.85 acceptance
target; the smoke test confirmed Bedrock Rerank works on the S3 Vectors KB in-region. Rerank clearly
earns its extra call: it lifts top-1 accuracy from 0.727 to 0.955 (+0.227) and MRR by +0.135, i.e. it
reliably pulls the right document to rank 1 where semantic-only ranks it a little lower. No systematic
exact-term/keyword miss was observed that hybrid would be needed to fix.

Caveat (honest): the 22 cases were authored from doc titles/front matter, so they lean
semantic-friendly and do not maximally stress the semantic-only keyword weakness the fallback guards
against. The decision is well-supported by this evidence, but the set can be hardened with adversarial
exact-term cases (bare ticket ids, server hostnames, stored-proc names) and re-run before treating it
as final. The cases file is private and lives outside the repo; it is never committed.

## How the evidence gets refreshed

The eval harness (`eval/`) is how we decide, on data, whether S3 Vectors semantic plus rerank clears
the quality bar. It reports hit rate and MRR with rerank off versus on, so rerank lift is visible
and rerank has to earn its extra call. If semantic plus rerank on the real corpus underperforms,
that result triggers the ADR-002 fallback to OpenSearch Serverless. Re-run:

```bash
cd eval && python3 -m venv ~/.venvs/homebase-eval && ~/.venvs/homebase-eval/bin/pip install -e '.[live]'
export AWS_REGION=us-east-1 HOMEBASE_KB_ID=<retrieval/knowledge_base_id>
export HOMEBASE_RERANK_MODEL_ARN=arn:aws:bedrock:us-east-1::foundation-model/cohere.rerank-v3-5:0
PYTHONPATH=src ~/.venvs/homebase-eval/bin/python -m homebase_eval.cli --mode live --k 5 --cases <your-private-cases.json>
```
