data "aws_region" "current" {}

locals {
  common_tags = merge({
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = "identity"
  }, var.tags)

  name_prefix = "${var.project_name}-${var.environment}"

  # OIDC issuer URL for the user pool. Used by the BFF to validate tokens.
  issuer_url = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.this.id}"

  # Resolve the Google client secret from its configured source. Never a literal.
  google_client_secret = var.google_client_secret_source == "secrets_manager" ? (
    length(data.aws_secretsmanager_secret_version.google) > 0 ? data.aws_secretsmanager_secret_version.google[0].secret_string : ""
  ) : var.google_client_secret
}

# Read the Google OAuth client secret from Secrets Manager when that source is
# selected. The secret value never enters the repo or Terraform code.
data "aws_secretsmanager_secret_version" "google" {
  count     = var.enable_google_federation && var.google_client_secret_source == "secrets_manager" ? 1 : 0
  secret_id = var.google_client_secret_name
}

# ---------------------------------------------------------------------------
# Cognito user pool. Email is the primary attribute; MFA is available; the
# password policy is strong. A custom tenant_id attribute keeps tenant identity
# explicit in the data model, per CLAUDE.md, without building multi-tenant
# features yet.
# ---------------------------------------------------------------------------
resource "aws_cognito_user_pool" "this" {
  name = local.name_prefix

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # MFA available (users may enable a TOTP authenticator).
  mfa_configuration = "OPTIONAL"

  software_token_mfa_configuration {
    enabled = true
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  # Sign-up allow-list gate (opt-in). When allowed_signup_emails is non-empty,
  # the Pre-Sign-Up Lambda rejects accounts whose email is not on the list, on
  # both the native and Google federation paths. See allowlist.tf.
  dynamic "lambda_config" {
    for_each = length(var.allowed_signup_emails) > 0 ? [1] : []
    content {
      pre_sign_up = aws_lambda_function.presignup[0].arn
    }
  }

  # Explicit tenant identity, kept for the future multi-tenant platform.
  schema {
    name                     = "tenant_id"
    attribute_data_type      = "String"
    mutable                  = true
    developer_only_attribute = false
    required                 = false

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# Google identity provider federation. Credentials come from variables /
# Secrets Manager, never hardcoded.
# ---------------------------------------------------------------------------
resource "aws_cognito_identity_provider" "google" {
  count = var.enable_google_federation ? 1 : 0

  user_pool_id  = aws_cognito_user_pool.this.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = var.google_client_id
    client_secret    = local.google_client_secret
    authorize_scopes = var.google_authorize_scopes
  }

  attribute_mapping = {
    email          = "email"
    username       = "sub"
    name           = "name"
    email_verified = "email_verified"
  }
}

# ---------------------------------------------------------------------------
# App client for the React SPA: authorization code flow with PKCE and NO client
# secret (public client, safe for the browser).
# ---------------------------------------------------------------------------
resource "aws_cognito_user_pool_client" "spa" {
  name         = "${local.name_prefix}-spa"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret = false

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]

  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls

  supported_identity_providers = concat(
    ["COGNITO"],
    var.enable_google_federation ? ["Google"] : [],
  )

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  prevent_user_existence_errors = "ENABLED"

  # The client's supported IdPs reference Google, so it must exist first.
  depends_on = [aws_cognito_identity_provider.google]
}

# ---------------------------------------------------------------------------
# Cognito hosted UI domain. Prefix comes from a variable.
# ---------------------------------------------------------------------------
resource "aws_cognito_user_pool_domain" "this" {
  domain       = var.hosted_ui_domain_prefix
  user_pool_id = aws_cognito_user_pool.this.id
}

# ---------------------------------------------------------------------------
# Non-secret identifiers exported to SSM Parameter Store as String, so later
# stacks and the BFF can read them without wiring remote state. Nothing secret
# is written here: only pool id, app client id, issuer, and hosted UI domain.
# ---------------------------------------------------------------------------
resource "aws_ssm_parameter" "user_pool_id" {
  name  = "/${var.project_name}/${var.environment}/identity/user_pool_id"
  type  = "String"
  value = aws_cognito_user_pool.this.id
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "app_client_id" {
  name  = "/${var.project_name}/${var.environment}/identity/app_client_id"
  type  = "String"
  value = aws_cognito_user_pool_client.spa.id
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "issuer_url" {
  name  = "/${var.project_name}/${var.environment}/identity/issuer_url"
  type  = "String"
  value = local.issuer_url
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "hosted_ui_domain" {
  name  = "/${var.project_name}/${var.environment}/identity/hosted_ui_domain"
  type  = "String"
  value = aws_cognito_user_pool_domain.this.domain
  tags  = local.common_tags
}
