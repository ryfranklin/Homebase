# ---------------------------------------------------------------------------
# Shared variables convention: region, project name, environment, tags.
# ---------------------------------------------------------------------------
variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
}

variable "project_name" {
  description = "Project name, used to derive the corpus bucket name."
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
# Corpus bucket.
# ---------------------------------------------------------------------------
variable "bucket_suffix" {
  description = "Suffix appended to the derived bucket name to make it globally unique (for example a short random string or account alias). Supplied as an input, never a literal."
  type        = string
}

variable "noncurrent_version_expiration_days" {
  description = "Days after which noncurrent object versions expire under the lifecycle policy."
  type        = number
  default     = 90
}

variable "abort_incomplete_multipart_days" {
  description = "Days after which incomplete multipart uploads are aborted under the lifecycle policy."
  type        = number
  default     = 7
}
