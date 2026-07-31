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
# Per-connector OAuth client credentials. All supplied via git-ignored tfvars;
# never committed. AgentCore Identity stores the secret. Client ids are inputs
# too (kept out of a public repo). Secrets use write-only args so they are not
# stored in state.
# ---------------------------------------------------------------------------

# Google backs Gmail, Calendar, and Drive (one OAuth client, per-target scopes).
# This is a NEW connector client, separate from the Cognito federation client (P3).
variable "google_client_id" {
  description = "OAuth client id for the Google connectors. From git-ignored tfvars."
  type        = string
  default     = ""
}
variable "google_client_secret" {
  description = "OAuth client secret for the Google connectors."
  type        = string
  default     = ""
  sensitive   = true
}
variable "google_secret_version" {
  description = "Bump to rotate the Google client secret (write-only version tag)."
  type        = string
  default     = "1"
}

# Slack: Homebase's OWN dedicated app in your workspace (its own scopes/creds).
variable "slack_client_id" {
  description = "OAuth client id for Homebase's dedicated Slack app."
  type        = string
  default     = ""
}
variable "slack_client_secret" {
  description = "OAuth client secret for Homebase's dedicated Slack app."
  type        = string
  default     = ""
  sensitive   = true
}
variable "slack_secret_version" {
  description = "Bump to rotate the Slack client secret."
  type        = string
  default     = "1"
}

# QuickBooks (Intuit).
variable "quickbooks_client_id" {
  description = "OAuth client id for the QuickBooks connector."
  type        = string
  default     = ""
}
variable "quickbooks_client_secret" {
  description = "OAuth client secret for the QuickBooks connector."
  type        = string
  default     = ""
  sensitive   = true
}
variable "quickbooks_secret_version" {
  description = "Bump to rotate the QuickBooks client secret."
  type        = string
  default     = "1"
}
variable "quickbooks_discovery_url" {
  description = "OIDC discovery URL for QuickBooks/Intuit. Placeholder in the example tfvars."
  type        = string
  default     = ""
}

# Atlassian (Jira / Confluence).
variable "atlassian_client_id" {
  description = "OAuth client id for the Atlassian connector."
  type        = string
  default     = ""
}
variable "atlassian_client_secret" {
  description = "OAuth client secret for the Atlassian connector."
  type        = string
  default     = ""
  sensitive   = true
}
variable "atlassian_secret_version" {
  description = "Bump to rotate the Atlassian client secret."
  type        = string
  default     = "1"
}
variable "atlassian_discovery_url" {
  description = "OIDC discovery URL for Atlassian. Placeholder in the example tfvars."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Shim Lambda ARNs (one per connector) for connectors reached via a shim. When a
# key is omitted, a derived placeholder ARN is used so plan/validate work; supply
# the real ARNs from git-ignored tfvars once the shims are deployed.
# ---------------------------------------------------------------------------
variable "connector_shim_lambda_arns" {
  description = "Map of connector name to shim Lambda ARN."
  type        = map(string)
  default     = {}
}
