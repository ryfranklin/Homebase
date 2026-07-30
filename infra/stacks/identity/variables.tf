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
# Hosted UI domain.
# ---------------------------------------------------------------------------
variable "hosted_ui_domain_prefix" {
  description = "Globally unique prefix for the Cognito hosted UI domain. Supplied as an input, never a literal."
  type        = string
}

# ---------------------------------------------------------------------------
# SPA app client callback and logout URLs.
# ---------------------------------------------------------------------------
variable "callback_urls" {
  description = "Allowed OAuth callback (redirect) URLs for the SPA app client. Placeholders in the example tfvars."
  type        = list(string)
}

variable "logout_urls" {
  description = "Allowed sign-out URLs for the SPA app client. Placeholders in the example tfvars."
  type        = list(string)
}

# ---------------------------------------------------------------------------
# Google federation.
#
# Two ways to supply the Google OAuth credentials. Never hardcode either one.
#
#   1. (default, preferred) Read the client secret from AWS Secrets Manager by
#      name. Set google_client_secret_source = "secrets_manager" and provide
#      google_client_secret_name. The client id is still a variable (low
#      sensitivity, but kept out of a public repo via git-ignored tfvars).
#
#   2. Supply both id and secret directly as variables from a git-ignored
#      tfvars. Set google_client_secret_source = "variable" and provide
#      google_client_secret. Use only when Secrets Manager is not available.
# ---------------------------------------------------------------------------
variable "enable_google_federation" {
  description = "Whether to configure the Google identity provider."
  type        = bool
  default     = true
}

variable "google_client_id" {
  description = "Google OAuth 2.0 client id. Supplied via git-ignored tfvars. Low sensitivity, but never committed to a public repo."
  type        = string
  default     = ""
}

variable "google_client_secret_source" {
  description = "Where the Google client secret comes from: 'secrets_manager' (default, preferred) or 'variable'."
  type        = string
  default     = "secrets_manager"

  validation {
    condition     = contains(["secrets_manager", "variable"], var.google_client_secret_source)
    error_message = "google_client_secret_source must be either 'secrets_manager' or 'variable'."
  }
}

variable "google_client_secret_name" {
  description = "Name (or ARN) of the AWS Secrets Manager secret holding the Google OAuth client secret. Used when source is 'secrets_manager'."
  type        = string
  default     = "homebase/google-oauth-client-secret"
}

variable "google_client_secret" {
  description = "Google OAuth client secret, supplied directly. Used ONLY when source is 'variable'. Never commit this; keep it in git-ignored tfvars."
  type        = string
  default     = ""
  sensitive   = true
}

# Scopes and attribute mapping for the Google IdP.
variable "google_authorize_scopes" {
  description = "OAuth scopes requested from Google."
  type        = string
  default     = "openid email profile"
}
