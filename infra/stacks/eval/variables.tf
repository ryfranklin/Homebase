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
# Container image. The batch runner image lives in this stack's ECR repo; the
# tag is bumped by scripts/deploy-eval.sh on every build.
# ---------------------------------------------------------------------------
variable "eval_image_tag" {
  description = "Image tag for the eval batch runner. scripts/deploy-eval.sh sets this to a unique deploy-<timestamp> tag."
  type        = string
  default     = "latest"
}

# ---------------------------------------------------------------------------
# The benchmark: which models to compare and which model judges. These are the
# defaults baked into the task definition; scripts/run-eval.sh can override the
# model set or judge per run. All must be ENABLED in Bedrock for the account.
# ---------------------------------------------------------------------------
variable "models" {
  description = "Model ids / inference profiles to benchmark. Verified enabled in the account before use."
  type        = list(string)
  default = [
    "us.anthropic.claude-sonnet-4-6",
    "qwen.qwen3-next-80b-a3b",
    "zai.glm-5",
  ]
}

variable "judge" {
  description = "Model id used as the LLM judge. Sonnet 4.6 is the top enabled Anthropic model and the only calibrated judge of the tested set."
  type        = string
  default     = "us.anthropic.claude-sonnet-4-6"
}

variable "additional_model_arns" {
  description = "Extra Bedrock ARNs to allow InvokeModel on, beyond those derived from models + judge. Escape hatch if a provider's on-demand ARN shape differs from the derived one."
  type        = list(string)
  default     = []
}

# ---------------------------------------------------------------------------
# Task sizing and storage.
# ---------------------------------------------------------------------------
variable "task_cpu" {
  description = "Fargate task CPU units."
  type        = number
  default     = 1024
}

variable "task_memory" {
  description = "Fargate task memory (MiB)."
  type        = number
  default     = 2048
}

variable "task_cpu_architecture" {
  description = "CPU architecture for the task (ARM64 or X86_64)."
  type        = string
  default     = "ARM64"
}

variable "artifact_retention_days" {
  description = "Days to keep raw prompt/response artifacts in S3 before expiry."
  type        = number
  default     = 90
}

variable "log_retention_days" {
  description = "CloudWatch log retention for the eval task."
  type        = number
  default     = 30
}

# ---------------------------------------------------------------------------
# Run identity. Homebase is the single-tenant seed of a multi-tenant platform;
# results are keyed by tenant and user even though one tenant exists today.
# ---------------------------------------------------------------------------
variable "tenant_id" {
  description = "Tenant id stamped on every run and result."
  type        = string
  default     = "homebase"
}

variable "user_id" {
  description = "User id stamped on every run and result."
  type        = string
  default     = "system"
}
