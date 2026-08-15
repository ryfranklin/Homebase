variable "aws_region" {
  description = "AWS region (must match the other Homebase stacks)."
  type        = string
}

variable "project_name" {
  description = "Project name prefix (matches foundation)."
  type        = string
  default     = "homebase"
}

variable "environment" {
  description = "Environment name (must match foundation)."
  type        = string
  default     = "prod"
}

variable "vpc_id" {
  description = "The shared foundation VPC id (the same value vault-worker and workstation use)."
  type        = string
}

variable "dns_namespace" {
  description = "Cloud Map private DNS namespace the vault-worker created; Mission Control registers mission-control.<namespace> in it."
  type        = string
  default     = "homebase.internal"
}

variable "image_tag" {
  description = "Tag of the Mission Control image in ECR to run."
  type        = string
  default     = "latest"
}

variable "github_token_secret_name" {
  description = "Name of the BY-HAND Secrets Manager secret holding the fine-grained GitHub token (Contents R/W on the target repos). The token is never in tfvars or state."
  type        = string
}

variable "worker_model" {
  description = "Bedrock model id / inference profile the coding worker uses (e.g. us.anthropic.claude-haiku-4-5-20251001-v1:0)."
  type        = string
}

variable "rds_subnet_cidrs" {
  description = "Two free /24 CIDRs in the VPC for the RDS-only private subnets (must be in two different AZs and not overlap any existing subnet). RDS needs a two-AZ subnet group."
  type        = list(string)
  validation {
    condition     = length(var.rds_subnet_cidrs) == 2
    error_message = "Provide exactly two CIDRs (RDS requires a two-AZ subnet group)."
  }
}

variable "db_instance_class" {
  description = "RDS instance class for the run ledger + checkpointer."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "RDS allocated storage (GB)."
  type        = number
  default     = 20
}

variable "task_cpu" {
  description = "Fargate task CPU units (service + Claude Code worker subprocess)."
  type        = string
  default     = "1024"
}

variable "task_memory" {
  description = "Fargate task memory (MiB)."
  type        = string
  default     = "2048"
}

variable "task_cpu_architecture" {
  description = "Fargate CPU architecture (ARM64 to match the other Homebase services)."
  type        = string
  default     = "ARM64"
}

variable "tags" {
  description = "Extra tags merged into every resource."
  type        = map(string)
  default     = {}
}
