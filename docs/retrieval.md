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

## How the evidence gets refreshed

The eval harness (`eval/`) is how we decide, on data, whether S3 Vectors semantic plus rerank clears
the quality bar. It reports hit rate and MRR with rerank off versus on, so rerank lift is visible
and rerank has to earn its extra call. If semantic plus rerank on the real corpus underperforms,
that result triggers the ADR-002 fallback to OpenSearch Serverless.
