# ---------------------------------------------------------------------------
# CloudTrail (H4): a management-plane audit trail so IAM changes, secret reads,
# KMS use, and console/root activity on this vault of personal data are recorded
# and forensically reconstructable. Multi-region, global service events, log-file
# validation on, KMS-encrypted, delivered to a dedicated bucket that blocks all
# public access, denies non-TLS access, and is readable only by the account.
# Toggleable (var.enable_cloudtrail) so an account already covered by an
# organization trail can opt out and avoid a duplicate-trail charge.
# ---------------------------------------------------------------------------
data "aws_caller_identity" "current" {}

locals {
  ct_account = data.aws_caller_identity.current.account_id
  ct_name    = "${local.name_prefix}-trail"
  # Constructed (not a resource reference) so the bucket policy can scope to the
  # trail via aws:SourceArn without a dependency cycle.
  ct_trail_arn = "arn:${data.aws_partition.current.partition}:cloudtrail:${var.aws_region}:${local.ct_account}:trail/${local.ct_name}"
}

module "cloudtrail_kms" {
  count  = var.enable_cloudtrail ? 1 : 0
  source = "../../modules/kms"

  alias              = "${local.name_prefix}-cloudtrail"
  description        = "Homebase ${var.environment} CloudTrail log encryption key"
  service_principals = ["cloudtrail.amazonaws.com"]
  tags               = local.common_tags
}

resource "aws_s3_bucket" "trail" {
  count  = var.enable_cloudtrail ? 1 : 0
  bucket = "${local.name_prefix}-cloudtrail-${local.ct_account}"
  tags   = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "trail" {
  count                   = var.enable_cloudtrail ? 1 : 0
  bucket                  = aws_s3_bucket.trail[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "trail" {
  count  = var.enable_cloudtrail ? 1 : 0
  bucket = aws_s3_bucket.trail[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "trail" {
  count  = var.enable_cloudtrail ? 1 : 0
  bucket = aws_s3_bucket.trail[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = module.cloudtrail_kms[0].key_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "trail" {
  count  = var.enable_cloudtrail ? 1 : 0
  bucket = aws_s3_bucket.trail[0].id
  rule {
    id     = "expire-trail"
    status = "Enabled"
    filter {}
    expiration {
      days = var.cloudtrail_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

data "aws_iam_policy_document" "trail" {
  count = var.enable_cloudtrail ? 1 : 0

  # CloudTrail checks the bucket ACL before writing.
  statement {
    sid       = "AWSCloudTrailAclCheck"
    effect    = "Allow"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.trail[0].arn]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.ct_trail_arn]
    }
  }

  # CloudTrail writes log objects; require bucket-owner-full-control and scope to
  # this trail + account path.
  statement {
    sid       = "AWSCloudTrailWrite"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.trail[0].arn}/AWSLogs/${local.ct_account}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.ct_trail_arn]
    }
  }

  # Refuse any non-TLS access, matching the other buckets.
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.trail[0].arn, "${aws_s3_bucket.trail[0].arn}/*"]
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

resource "aws_s3_bucket_policy" "trail" {
  count  = var.enable_cloudtrail ? 1 : 0
  bucket = aws_s3_bucket.trail[0].id
  policy = data.aws_iam_policy_document.trail[0].json
}

resource "aws_cloudtrail" "this" {
  count = var.enable_cloudtrail ? 1 : 0

  name                          = local.ct_name
  s3_bucket_name                = aws_s3_bucket.trail[0].id
  kms_key_id                    = module.cloudtrail_kms[0].key_arn
  is_multi_region_trail         = true
  include_global_service_events = true
  enable_log_file_validation    = true
  tags                          = local.common_tags

  # The bucket policy must exist before the trail can validate write access.
  depends_on = [aws_s3_bucket_policy.trail]
}
