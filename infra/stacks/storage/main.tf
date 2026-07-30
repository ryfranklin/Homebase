locals {
  common_tags = merge({
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = "storage"
  }, var.tags)

  name_prefix = "${var.project_name}-${var.environment}"

  # Bucket name is derived from inputs, never a literal.
  corpus_bucket_name = "${local.name_prefix}-corpus-${var.bucket_suffix}"
}

# Customer managed key for the corpus at rest.
module "corpus_kms" {
  source = "../../modules/kms"

  alias       = "${local.name_prefix}-corpus"
  description = "Encrypts the Homebase source corpus bucket"
  tags        = local.common_tags
}

# ---------------------------------------------------------------------------
# Source corpus bucket: private, versioned, KMS-encrypted, public access
# blocked, with a lifecycle policy for noncurrent versions and stale uploads.
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "corpus" {
  bucket = local.corpus_bucket_name
  tags   = local.common_tags
}

resource "aws_s3_bucket_versioning" "corpus" {
  bucket = aws_s3_bucket.corpus.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "corpus" {
  bucket = aws_s3_bucket.corpus.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = module.corpus_kms.key_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "corpus" {
  bucket = aws_s3_bucket.corpus.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "corpus" {
  bucket = aws_s3_bucket.corpus.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "corpus" {
  bucket = aws_s3_bucket.corpus.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_expiration_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = var.abort_incomplete_multipart_days
    }
  }
}

# Refuse any non-TLS access to the corpus bucket.
data "aws_iam_policy_document" "corpus" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.corpus.arn, "${aws_s3_bucket.corpus.arn}/*"]

    principals {
      type        = "AWS"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "corpus" {
  bucket = aws_s3_bucket.corpus.id
  policy = data.aws_iam_policy_document.corpus.json

  depends_on = [aws_s3_bucket_public_access_block.corpus]
}

# ---------------------------------------------------------------------------
# Non-secret identifiers exported to SSM for later stacks (ingestion, the
# Bedrock Knowledge Base in P5). Nothing secret here.
# ---------------------------------------------------------------------------
resource "aws_ssm_parameter" "corpus_bucket_name" {
  name  = "/${var.project_name}/${var.environment}/storage/corpus_bucket_name"
  type  = "String"
  value = aws_s3_bucket.corpus.id
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "corpus_kms_key_arn" {
  name  = "/${var.project_name}/${var.environment}/storage/corpus_kms_key_arn"
  type  = "String"
  value = module.corpus_kms.key_arn
  tags  = local.common_tags
}
