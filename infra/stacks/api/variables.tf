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
# CORS: restrict to the SPA origin. In P8 this is the CloudFront/app URL.
# ---------------------------------------------------------------------------
variable "spa_origin" {
  description = "Allowed browser origin for the SPA (for example https://app.example.invalid). Set to your CloudFront/app URL."
  type        = string
  default     = "https://app.example.invalid"
}

# ---------------------------------------------------------------------------
# Function URL auth. NONE (default) means the in-function Cognito JWT check is
# the gate. AWS_IAM enables the CloudFront OAC signing path (a documented seam);
# see README for the POST body-signing caveat.
# ---------------------------------------------------------------------------
variable "function_url_auth_type" {
  description = "Lambda Function URL auth type: NONE (in-function JWT gate, default) or AWS_IAM (CloudFront OAC signing)."
  type        = string
  default     = "NONE"

  validation {
    condition     = contains(["NONE", "AWS_IAM"], var.function_url_auth_type)
    error_message = "function_url_auth_type must be NONE or AWS_IAM."
  }
}

variable "lambda_memory_mb" {
  description = "Memory for the BFF Lambda."
  type        = number
  default     = 512
}

variable "lambda_timeout_seconds" {
  description = "Timeout for the BFF Lambda (long enough for a streamed agent turn)."
  type        = number
  default     = 300
}

variable "origin_secret_rotation_days" {
  description = "How often Secrets Manager rotates the CloudFront origin shared secret."
  type        = number
  default     = 30
}
