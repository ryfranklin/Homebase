# ---------------------------------------------------------------------------
# Shared variables: region, project name, environment, tags.
# ---------------------------------------------------------------------------
variable "aws_region" {
  description = "AWS region to deploy into (must match the other Homebase stacks)."
  type        = string
}

variable "project_name" {
  description = "Project name, used as a prefix for resource names."
  type        = string
  default     = "homebase"
}

variable "environment" {
  description = "Environment label (must match foundation, e.g. dev, prod)."
  type        = string
  default     = "prod"
}

variable "tags" {
  description = "Additional tags merged onto the common tag set applied to every resource."
  type        = map(string)
  default     = {}
}

# ---------------------------------------------------------------------------
# Networking. The security group lives in the shared foundation VPC; the task
# runs in the vault-worker private subnet (read from SSM), which already has NAT
# egress for the outbound Socket Mode WebSocket.
# ---------------------------------------------------------------------------
variable "vpc_id" {
  description = "The shared foundation VPC id (same value the vault-worker and mission-control use)."
  type        = string
}

# ---------------------------------------------------------------------------
# Identity presented to the agent. The bridge uses the resolved Slack email as
# the user id per message; the tenant is fixed here (single-tenant seed).
# ---------------------------------------------------------------------------
variable "tenant_id" {
  description = "Tenant id the bridge presents to the agent for every Slack user."
  type        = string
  default     = "homebase"
}

# ---------------------------------------------------------------------------
# By-hand Slack secrets (values NEVER in tfvars or state; referenced by name).
# Create them from the Slack app config before the service can connect:
#   - bot token  (xoxb-...): OAuth & Permissions; scopes chat:write, users:read.email,
#     app_mentions:read, im:history, im:read, im:write
#   - app token  (xapp-...): Basic Information -> App-Level Tokens; scope connections:write
# ---------------------------------------------------------------------------
variable "slack_bot_token_secret_name" {
  description = "Name of the by-hand Secrets Manager secret holding the Slack bot token (xoxb-...)."
  type        = string
}

variable "slack_app_token_secret_name" {
  description = "Name of the by-hand Secrets Manager secret holding the Slack app-level token (xapp-...) for Socket Mode."
  type        = string
}

# ---------------------------------------------------------------------------
# Task sizing and image.
# ---------------------------------------------------------------------------
variable "image_tag" {
  description = "Tag of the slackbot container image in the ECR repo this stack creates."
  type        = string
  default     = "latest"
}

variable "task_cpu" {
  description = "Fargate task CPU units."
  type        = number
  default     = 256
}

variable "task_memory" {
  description = "Fargate task memory (MiB)."
  type        = number
  default     = 512
}

variable "desired_count" {
  description = "Number of running tasks. Keep at 1: a single Socket Mode connection is enough, and multiple would each answer the same event."
  type        = number
  default     = 1
}

variable "task_cpu_architecture" {
  description = "Fargate CPU architecture: ARM64 (default) or X86_64. Build the image for the matching platform (linux/arm64 or linux/amd64)."
  type        = string
  default     = "ARM64"

  validation {
    condition     = contains(["ARM64", "X86_64"], var.task_cpu_architecture)
    error_message = "task_cpu_architecture must be ARM64 or X86_64."
  }
}
