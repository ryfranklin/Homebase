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
# CI/CD web-deploy role. This role is assumed by GitHub Actions over OIDC to
# publish the built SPA (S3 sync + CloudFront invalidation). It is deploy-only:
# no terraform, no IAM, no agent. The repo slug is an INPUT so it is not a
# committed literal (placeholder in terraform.tfvars.example).
# ---------------------------------------------------------------------------
variable "github_repo" {
  description = "GitHub repository slug (owner/name) allowed to assume the deploy role. Only its main branch is trusted."
  type        = string
}

variable "web_bucket_name" {
  description = "Name of the S3 bucket that serves the SPA (the web stack's static bucket). The deploy role may sync objects into only this bucket."
  type        = string
}

variable "github_oidc_provider_arn" {
  description = "ARN of an EXISTING GitHub Actions OIDC provider to reuse. Leave empty to have this stack create the provider (only one per account is allowed)."
  type        = string
  default     = ""
}
