data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

# The CloudFront distribution id is published by the web stack to SSM. Reading it
# here keeps the deploy policy scoped to exactly that distribution without
# duplicating the id as a literal.
data "aws_ssm_parameter" "distribution_id" {
  name = "/${var.project_name}/${var.environment}/web/distribution_id"
}

locals {
  common_tags = merge({
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = "cicd"
  }, var.tags)

  name_prefix = "${var.project_name}-${var.environment}"

  partition       = data.aws_partition.current.partition
  account_id      = data.aws_caller_identity.current.account_id
  distribution_id = data.aws_ssm_parameter.distribution_id.value

  # Reuse a passed-in OIDC provider if given, otherwise the one created below.
  oidc_provider_arn = var.github_oidc_provider_arn != "" ? var.github_oidc_provider_arn : aws_iam_openid_connect_provider.github[0].arn
}

# ---------------------------------------------------------------------------
# GitHub Actions OIDC provider. Only one per account is permitted; if the
# account already has one, set github_oidc_provider_arn and this is skipped.
# The thumbprint is GitHub's well-known intermediate CA; AWS also validates the
# token signature independently of it.
# ---------------------------------------------------------------------------
resource "aws_iam_openid_connect_provider" "github" {
  count = var.github_oidc_provider_arn == "" ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = { Name = "${local.name_prefix}-github-oidc" }
}

# ---------------------------------------------------------------------------
# Trust policy: only GitHub's OIDC issuer, only the sts.amazonaws.com audience,
# and only the main branch of the named repository may assume this role.
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "web_deploy" {
  name                 = "${local.name_prefix}-web-deploy"
  description          = "Assumed by GitHub Actions (main branch) to publish the SPA: S3 sync + CloudFront invalidation only."
  assume_role_policy   = data.aws_iam_policy_document.trust.json
  max_session_duration = 3600
}

# ---------------------------------------------------------------------------
# Least-privilege deploy policy. The bucket is SSE-S3 (AES256), so no KMS grant
# is needed. Scope is exactly the web bucket and the web distribution.
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "ListWebBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = ["arn:${local.partition}:s3:::${var.web_bucket_name}"]
  }

  statement {
    sid    = "WriteWebObjects"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["arn:${local.partition}:s3:::${var.web_bucket_name}/*"]
  }

  statement {
    sid    = "InvalidateWebDistribution"
    effect = "Allow"
    actions = [
      "cloudfront:CreateInvalidation",
      "cloudfront:GetInvalidation",
    ]
    resources = ["arn:${local.partition}:cloudfront::${local.account_id}:distribution/${local.distribution_id}"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "web-deploy"
  role   = aws_iam_role.web_deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
