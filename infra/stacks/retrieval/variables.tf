# ---------------------------------------------------------------------------
# Shared variables convention: region, project name, environment, tags.
# ---------------------------------------------------------------------------
variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
}

variable "project_name" {
  description = "Project name, used as a prefix for resource names."
  type        = string
  default     = "homebase"
}

variable "environment" {
  description = "Environment label (for example dev, staging, prod)."
  type        = string
  default     = "dev"
}

variable "tags" {
  description = "Additional tags merged onto the common tag set applied to every resource."
  type        = map(string)
  default     = {}
}

# ---------------------------------------------------------------------------
# Vector store selection (evidence-based seam).
#
# S3 Vectors is semantic-only: it does NOT support hybrid (dense + keyword)
# search. Rerank still works (it is a query-time step). If hybrid becomes a hard
# requirement, the documented fallback is OpenSearch Serverless (ADR-002). See
# docs/retrieval.md. That path is a deliberate, marked seam, not implemented
# here, so this stack never emits a config that will not apply.
# ---------------------------------------------------------------------------
variable "vector_store_type" {
  description = "Vector store backing the knowledge base. Only S3_VECTORS is implemented; OPENSEARCH_SERVERLESS is the documented hybrid-capable fallback (ADR-002)."
  type        = string
  default     = "S3_VECTORS"

  validation {
    condition     = var.vector_store_type == "S3_VECTORS"
    error_message = "Only S3_VECTORS is implemented in this stack. For hybrid search, use the OpenSearch Serverless fallback (ADR-002, docs/retrieval.md); do not silently select an unimplemented store."
  }
}

# ---------------------------------------------------------------------------
# Embeddings. Model id is a variable so Titan v2 vs Cohere can be swapped
# without code changes. Dimension must match the chosen model.
# ---------------------------------------------------------------------------
variable "embedding_model_id" {
  description = "Bedrock embeddings model id (for example amazon.titan-embed-text-v2:0 or cohere.embed-english-v3)."
  type        = string
  default     = "amazon.titan-embed-text-v2:0"
}

variable "embedding_dimension" {
  description = "Embedding vector dimension. Must match embedding_model_id (Titan v2: 256/512/1024; Cohere v3: 1024)."
  type        = number
  default     = 1024
}

# ---------------------------------------------------------------------------
# Reranking. Rerank is a query-time step (not part of the KB storage config),
# but the model id is recorded here (as a variable) and exported to SSM so the
# eval harness and agent can use it without hardcoding. Swap Amazon vs Cohere
# rerank without code changes.
# ---------------------------------------------------------------------------
variable "rerank_model_id" {
  description = "Bedrock rerank model id used at query time. Availability is region-specific: us-east-1 offers cohere.rerank-v3-5:0 (not amazon.rerank-v1:0). Verify with `aws bedrock list-foundation-models` filtered to rerank models in your region."
  type        = string
  default     = "cohere.rerank-v3-5:0"
}

variable "default_search_type" {
  description = "Default retrieval search type recorded for downstream use. S3 Vectors supports only SEMANTIC; HYBRID requires the OpenSearch Serverless fallback."
  type        = string
  default     = "SEMANTIC"

  validation {
    condition     = contains(["SEMANTIC", "HYBRID"], var.default_search_type)
    error_message = "default_search_type must be SEMANTIC or HYBRID. HYBRID is only honored on a hybrid-capable store (not S3 Vectors)."
  }
}

# ---------------------------------------------------------------------------
# S3 Vectors index tuning.
# ---------------------------------------------------------------------------
variable "vector_data_type" {
  description = "Vector element data type for the S3 Vectors index."
  type        = string
  default     = "float32"
}

variable "vector_distance_metric" {
  description = "Distance metric for the S3 Vectors index."
  type        = string
  default     = "cosine"
}

variable "non_filterable_metadata_keys" {
  description = "Metadata keys stored but not filterable. Bedrock stores chunk text and metadata under these reserved keys."
  type        = list(string)
  default     = ["AMAZON_BEDROCK_TEXT", "AMAZON_BEDROCK_METADATA"]
}

# ---------------------------------------------------------------------------
# Chunking for the S3 data source ingestion.
# ---------------------------------------------------------------------------
variable "chunk_max_tokens" {
  description = "Maximum tokens per chunk for fixed-size chunking."
  type        = number
  default     = 512
}

variable "chunk_overlap_percentage" {
  description = "Overlap percentage between adjacent chunks."
  type        = number
  default     = 20
}

variable "data_deletion_policy" {
  description = "What happens to vectors when the data source is deleted: DELETE or RETAIN."
  type        = string
  default     = "RETAIN"
}
