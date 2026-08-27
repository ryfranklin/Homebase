data "aws_partition" "current" {}

# Non-secret identifiers published by the api stack (P7).
data "aws_ssm_parameter" "bff_function_url" {
  name = "/${var.project_name}/${var.environment}/api/bff_function_url"
}

data "aws_ssm_parameter" "origin_secret_arn" {
  name = "/${var.project_name}/${var.environment}/api/origin_secret_arn"
}

# The shared secret CloudFront injects on origin requests, read from Secrets
# Manager (never a literal). Read at plan/apply time; validate does not call AWS.
data "aws_secretsmanager_secret_version" "origin_secret" {
  secret_id = data.aws_ssm_parameter.origin_secret_arn.value
}

locals {
  common_tags = merge({
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = "web"
  }, var.tags)

  name_prefix         = "${var.project_name}-${var.environment}"
  static_bucket_name  = "${local.name_prefix}-web-${var.bucket_suffix}"
  function_url        = data.aws_ssm_parameter.bff_function_url.value
  function_url_host   = trimsuffix(trimprefix(local.function_url, "https://"), "/")
  use_custom_cert     = var.acm_certificate_arn != ""
  s3_origin_id        = "s3-static"
  bff_origin_id       = "bff-function-url"
  origin_secret_value = data.aws_secretsmanager_secret_version.origin_secret.secret_string
}

# ---------------------------------------------------------------------------
# Private S3 bucket for the static SPA bundle. No public access; served only via
# CloudFront using Origin Access Control.
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "static" {
  bucket = local.static_bucket_name
  tags   = local.common_tags
}

resource "aws_s3_bucket_versioning" "static" {
  bucket = aws_s3_bucket.static.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "static" {
  bucket                  = aws_s3_bucket.static.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "static" {
  bucket = aws_s3_bucket.static.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# The SPA bundle is world-readable content served publicly through CloudFront, so
# SSE-S3 (rather than KMS) is used here; it avoids the OAC-plus-KMS circular
# dependency and adds no value for content that is intentionally public.
resource "aws_s3_bucket_server_side_encryption_configuration" "static" {
  bucket = aws_s3_bucket.static.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${local.name_prefix}-s3-oac"
  description                       = "OAC for the private static bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ---------------------------------------------------------------------------
# WAF web ACL (must be us-east-1 for CloudFront): managed rule groups plus a
# rate-based rule.
# ---------------------------------------------------------------------------
resource "aws_wafv2_web_acl" "this" {
  provider = aws.us_east_1

  name  = "${local.name_prefix}-web-acl"
  scope = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # Optional geo allowlist: block anything NOT in the allowed countries. Stays
  # off by default (empty list), so it never surprises legitimate travel/roaming.
  dynamic "rule" {
    for_each = length(var.waf_geo_allowed_countries) > 0 ? [1] : []
    content {
      name     = "GeoAllowlist"
      priority = 0
      action {
        block {}
      }
      statement {
        not_statement {
          statement {
            geo_match_statement {
              country_codes = var.waf_geo_allowed_countries
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${local.name_prefix}-geo"
        sampled_requests_enabled   = true
      }
    }
  }

  rule {
    name     = "AWSCommonRules"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"

        # Set selected rules to COUNT so mobile use and small chat POST bodies are
        # not blocked (for example SizeRestrictions_BODY). Empty by default.
        dynamic "rule_action_override" {
          for_each = var.waf_common_rules_count_only
          content {
            name = rule_action_override.value
            action_to_use {
              count {}
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSKnownBadInputs"
    priority = 2
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "RateLimit"
    priority = 3
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name_prefix}-web-acl"
    sampled_requests_enabled   = true
  }

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# CloudFront distribution: S3 static origin (default) plus the BFF Function URL
# origin at /api/*. The BFF origin carries the shared-secret custom header so
# direct-to-origin requests that bypass CloudFront and the WAF are refused.
# ---------------------------------------------------------------------------
data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

# Security response headers applied to every viewer response. HSTS, nosniff, frame
# DENY, and a strict referrer policy are always on (non-breaking). A CSP is added
# only when var.content_security_policy is set, since a wrong CSP can break auth or
# the Markdown/Mermaid rendering; it is opt-in and tested per environment.
resource "aws_cloudfront_response_headers_policy" "security" {
  name = "${local.name_prefix}-security-headers"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 63072000 # 2 years
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    dynamic "content_security_policy" {
      for_each = var.content_security_policy != "" ? [1] : []
      content {
        content_security_policy = var.content_security_policy
        override                = true
      }
    }
  }
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  comment             = "${local.name_prefix} SPA"
  default_root_object = "index.html"
  price_class         = var.price_class
  web_acl_id          = aws_wafv2_web_acl.this.arn
  aliases             = var.domain_names

  origin {
    origin_id                = local.s3_origin_id
    domain_name              = aws_s3_bucket.static.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  origin {
    origin_id   = local.bff_origin_id
    domain_name = local.function_url_host

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      # The agent can run a multi-step tool loop for tens of seconds. Raise the
      # origin response timeout to the 60s max (the BFF also sends SSE keepalives),
      # so a long turn does not 504. Higher than 60s needs a service quota increase.
      origin_read_timeout = 60
    }

    # Shared secret injected on every origin request. The BFF refuses requests
    # without it, closing the direct-to-origin WAF-bypass hole.
    custom_header {
      name  = "X-Origin-Secret"
      value = local.origin_secret_value
    }
  }

  # SPA static content.
  default_cache_behavior {
    target_origin_id           = local.s3_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    compress                   = true
  }

  # Streaming API: no caching, forward Authorization and the request body.
  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = local.bff_origin_id
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    compress                   = false
  }

  # SPA client-side routing: serve index.html for not-found paths.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = local.use_custom_cert ? null : true
    acm_certificate_arn            = local.use_custom_cert ? var.acm_certificate_arn : null
    ssl_support_method             = local.use_custom_cert ? "sni-only" : null
    minimum_protocol_version       = local.use_custom_cert ? "TLSv1.2_2021" : "TLSv1"
  }

  tags = local.common_tags
}

# Bucket policy: allow only this CloudFront distribution (via OAC) to read.
data "aws_iam_policy_document" "static" {
  statement {
    sid       = "AllowCloudFrontOACRead"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.static.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.static.arn, "${aws_s3_bucket.static.arn}/*"]

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

resource "aws_s3_bucket_policy" "static" {
  bucket = aws_s3_bucket.static.id
  policy = data.aws_iam_policy_document.static.json

  depends_on = [aws_s3_bucket_public_access_block.static]
}

# Non-secret identifiers exported to SSM.
resource "aws_ssm_parameter" "distribution_domain" {
  name  = "/${var.project_name}/${var.environment}/web/distribution_domain"
  type  = "String"
  value = aws_cloudfront_distribution.this.domain_name
  tags  = local.common_tags
}

# Published so the origin-secret rotation Lambda (P12, api stack) can update this
# distribution's shared-secret header when it rotates.
resource "aws_ssm_parameter" "distribution_id" {
  name  = "/${var.project_name}/${var.environment}/web/distribution_id"
  type  = "String"
  value = aws_cloudfront_distribution.this.id
  tags  = local.common_tags
}

# The origin id whose custom header carries the shared secret (the rotation
# Lambda targets this origin).
resource "aws_ssm_parameter" "bff_origin_id" {
  name  = "/${var.project_name}/${var.environment}/web/bff_origin_id"
  type  = "String"
  value = local.bff_origin_id
  tags  = local.common_tags
}
