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
# Cost / usage guardrails. $ budgeting lives in AWS Budgets (P2); these are
# in-region CloudWatch signals wired to the SAME P2 SNS topic.
# ---------------------------------------------------------------------------
variable "bedrock_invocations_threshold" {
  description = "Alarm when Bedrock invocations in a 1-hour window exceed this (a spend proxy; $ budgeting is P2 Budgets)."
  type        = number
  default     = 5000
}

variable "bedrock_output_tokens_threshold" {
  description = "Alarm when Bedrock output tokens in a 1-hour window exceed this (a spend proxy)."
  type        = number
  default     = 5000000
}

variable "workstation_instance_id" {
  description = "Workstation instance id (from the workstation stack). Empty disables the uptime alert."
  type        = string
  default     = ""
}

variable "workstation_uptime_threshold_hours" {
  description = "Alert when the workstation has been running at least this many hours."
  type        = number
  default     = 12
}

variable "uptime_check_schedule" {
  description = "Schedule expression for the workstation uptime check."
  type        = string
  default     = "rate(1 hour)"
}

# ---------------------------------------------------------------------------
# Dashboard optional resource ids (from other stacks' outputs). Widgets that
# reference them are included only when provided.
# ---------------------------------------------------------------------------
variable "cloudfront_distribution_id" {
  description = "CloudFront distribution id (from the web stack) for the front-doors dashboard."
  type        = string
  default     = ""
}

variable "enable_cloudtrail" {
  description = "Create a multi-region CloudTrail (management events) to a dedicated KMS-encrypted, locked-down S3 bucket. On by default; disable if the account is already covered by an organization trail."
  type        = bool
  default     = true
}

variable "cloudtrail_retention_days" {
  description = "Days to retain CloudTrail objects in the log bucket before expiry."
  type        = number
  default     = 365
}
