data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}

# Non-secret identifiers published by the storage stack (P4). Read at plan/apply
# time; validate does not call AWS.
data "aws_ssm_parameter" "corpus_bucket_name" {
  name = "/${var.project_name}/${var.environment}/storage/corpus_bucket_name"
}

data "aws_ssm_parameter" "corpus_kms_key_arn" {
  name = "/${var.project_name}/${var.environment}/storage/corpus_kms_key_arn"
}

locals {
  common_tags = merge({
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = "retrieval"
  }, var.tags)

  name_prefix = "${var.project_name}-${var.environment}"

  vector_bucket_name = "${local.name_prefix}-vectors"
  index_name         = "${local.name_prefix}-index"

  corpus_bucket_name = data.aws_ssm_parameter.corpus_bucket_name.value
  corpus_bucket_arn  = "arn:${data.aws_partition.current.partition}:s3:::${local.corpus_bucket_name}"
  corpus_kms_key_arn = data.aws_ssm_parameter.corpus_kms_key_arn.value

  embedding_model_arn = "arn:${data.aws_partition.current.partition}:bedrock:${var.aws_region}::foundation-model/${var.embedding_model_id}"

  # Rerank is applied at query time via the Retrieve API. Bedrock performs the
  # rerank under THIS KB service role (assumed as BedrockReranking-*), not the
  # caller's role, so the KB role itself needs bedrock:Rerank on the rerank model.
  rerank_model_arn = "arn:${data.aws_partition.current.partition}:bedrock:${var.aws_region}::foundation-model/${var.rerank_model_id}"
}

# ---------------------------------------------------------------------------
# S3 Vectors store: a vector bucket and an index sized to the embedding model.
# ---------------------------------------------------------------------------
resource "aws_s3vectors_vector_bucket" "this" {
  vector_bucket_name = local.vector_bucket_name

  encryption_configuration = [{
    sse_type    = "aws:kms"
    kms_key_arn = local.corpus_kms_key_arn
  }]

  tags = local.common_tags
}

resource "aws_s3vectors_index" "this" {
  vector_bucket_name = aws_s3vectors_vector_bucket.this.vector_bucket_name
  index_name         = local.index_name
  data_type          = var.vector_data_type
  dimension          = var.embedding_dimension
  distance_metric    = var.vector_distance_metric

  metadata_configuration {
    non_filterable_metadata_keys = var.non_filterable_metadata_keys
  }

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# IAM service role that Bedrock assumes to read the corpus, invoke the
# embeddings model, and write to the S3 Vectors index.
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "kb_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["bedrock.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "kb" {
  name               = "${local.name_prefix}-kb-role"
  assume_role_policy = data.aws_iam_policy_document.kb_trust.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "kb" {
  statement {
    sid       = "InvokeEmbeddingModel"
    effect    = "Allow"
    actions   = ["bedrock:InvokeModel"]
    resources = [local.embedding_model_arn]
  }

  # Query-time reranking. Retrieve with a rerankingConfiguration makes Bedrock
  # invoke the rerank model under this KB role. Without this, Retrieve-with-rerank
  # 403s and the agent's rerank rung (and the ADR-002 eval) fail.
  #
  # bedrock:Rerank does NOT support resource-level scoping to the model ARN (it
  # evaluates against a system rerank resource), so AWS requires resource "*" for
  # the action. The rerank model itself is still scoped, via InvokeModel below.
  statement {
    sid       = "Rerank"
    effect    = "Allow"
    actions   = ["bedrock:Rerank"]
    resources = ["*"]
  }

  statement {
    sid       = "InvokeRerankModel"
    effect    = "Allow"
    actions   = ["bedrock:InvokeModel"]
    resources = [local.rerank_model_arn]
  }

  statement {
    sid       = "ReadCorpusBucket"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [local.corpus_bucket_arn, "${local.corpus_bucket_arn}/*"]
  }

  statement {
    sid    = "AccessVectorStore"
    effect = "Allow"
    actions = [
      "s3vectors:GetIndex",
      "s3vectors:ListVectors",
      "s3vectors:PutVectors",
      "s3vectors:GetVectors",
      "s3vectors:DeleteVectors",
      "s3vectors:QueryVectors",
    ]
    resources = [
      aws_s3vectors_vector_bucket.this.vector_bucket_arn,
      "${aws_s3vectors_vector_bucket.this.vector_bucket_arn}/*",
    ]
  }

  statement {
    sid       = "UseCorpusKmsKey"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [local.corpus_kms_key_arn]
  }
}

resource "aws_iam_role_policy" "kb" {
  name   = "${local.name_prefix}-kb-policy"
  role   = aws_iam_role.kb.id
  policy = data.aws_iam_policy_document.kb.json
}

# ---------------------------------------------------------------------------
# Bedrock Knowledge Base backed by S3 Vectors.
#
# Note: hybrid (dense + keyword) is NOT available on S3 Vectors; it is
# semantic-only. Rerank is applied at query time via the Retrieve /
# RetrieveAndGenerate API (rerank_model_id is exported to SSM below), not here.
# The hybrid-capable fallback is OpenSearch Serverless (ADR-002).
# ---------------------------------------------------------------------------
resource "aws_bedrockagent_knowledge_base" "this" {
  name     = "${local.name_prefix}-kb"
  role_arn = aws_iam_role.kb.arn

  knowledge_base_configuration {
    type = "VECTOR"

    vector_knowledge_base_configuration {
      embedding_model_arn = local.embedding_model_arn

      embedding_model_configuration {
        bedrock_embedding_model_configuration {
          dimensions          = var.embedding_dimension
          embedding_data_type = "FLOAT32"
        }
      }
    }
  }

  storage_configuration {
    type = "S3_VECTORS"

    s3_vectors_configuration {
      vector_bucket_arn = aws_s3vectors_vector_bucket.this.vector_bucket_arn
      index_name        = aws_s3vectors_index.this.index_name
    }
  }

  tags = local.common_tags

  depends_on = [aws_iam_role_policy.kb]
}

# ---------------------------------------------------------------------------
# Data source: the corpus bucket from the storage stack (P4).
# ---------------------------------------------------------------------------
resource "aws_bedrockagent_data_source" "corpus" {
  knowledge_base_id    = aws_bedrockagent_knowledge_base.this.id
  name                 = "${local.name_prefix}-corpus"
  data_deletion_policy = var.data_deletion_policy

  data_source_configuration {
    type = "S3"

    s3_configuration {
      bucket_arn = local.corpus_bucket_arn
    }
  }

  vector_ingestion_configuration {
    chunking_configuration {
      chunking_strategy = "FIXED_SIZE"

      fixed_size_chunking_configuration {
        max_tokens         = var.chunk_max_tokens
        overlap_percentage = var.chunk_overlap_percentage
      }
    }
  }
}

# ---------------------------------------------------------------------------
# Non-secret identifiers exported to SSM for the ingestion trigger, the eval
# harness, and the agent (P6). Nothing secret is stored.
# ---------------------------------------------------------------------------
resource "aws_ssm_parameter" "knowledge_base_id" {
  name  = "/${var.project_name}/${var.environment}/retrieval/knowledge_base_id"
  type  = "String"
  value = aws_bedrockagent_knowledge_base.this.id
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "data_source_id" {
  name  = "/${var.project_name}/${var.environment}/retrieval/data_source_id"
  type  = "String"
  value = aws_bedrockagent_data_source.corpus.data_source_id
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "rerank_model_id" {
  name  = "/${var.project_name}/${var.environment}/retrieval/rerank_model_id"
  type  = "String"
  value = var.rerank_model_id
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "default_search_type" {
  name  = "/${var.project_name}/${var.environment}/retrieval/default_search_type"
  type  = "String"
  value = var.default_search_type
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "embedding_model_id" {
  name  = "/${var.project_name}/${var.environment}/retrieval/embedding_model_id"
  type  = "String"
  value = var.embedding_model_id
  tags  = local.common_tags
}
