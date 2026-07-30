variable "aws_region" {
  description = "AWS region for the remote-state backend resources."
  type        = string
}

variable "state_bucket_name" {
  description = "Globally unique name for the S3 state bucket. Supplied as an input, never a literal in code."
  type        = string
}

variable "lock_table_name" {
  description = "Name for the DynamoDB state lock table."
  type        = string
  default     = "homebase-tf-locks"
}

variable "project_name" {
  description = "Project name used for tagging and the KMS alias."
  type        = string
  default     = "homebase"
}

variable "environment" {
  description = "Environment label for the backend resources. These are shared, so 'global' is a sensible default."
  type        = string
  default     = "global"
}

variable "tags" {
  description = "Additional tags merged onto the default tag set."
  type        = map(string)
  default     = {}
}
