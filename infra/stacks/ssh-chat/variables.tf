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
# Networking. From the foundation stack (P2) outputs. The private subnets must
# have the VPC endpoints the task needs with no NAT: ssm, ssmmessages,
# ec2messages (ECS Exec), ecr.api/ecr.dkr (image pull), logs, and
# bedrock-agentcore (agent invoke). Ensure foundation's interface_endpoints
# includes bedrock-agentcore.
# ---------------------------------------------------------------------------
variable "vpc_id" {
  description = "VPC id from the foundation stack."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet ids from the foundation stack. The task runs here with no public IP."
  type        = list(string)
}

# ---------------------------------------------------------------------------
# Identity supplied to the CLI task (you, for now). Keeps tenant scoping aligned
# with the GUI and the multi-tenant seam intact.
# ---------------------------------------------------------------------------
variable "cli_user_id" {
  description = "User id the CLI task presents to the agent."
  type        = string
}

variable "cli_tenant_id" {
  description = "Tenant id the CLI task presents to the agent."
  type        = string
}

# ---------------------------------------------------------------------------
# Task sizing and image.
# ---------------------------------------------------------------------------
variable "image_tag" {
  description = "Tag of the CLI container image in the ECR repo this stack creates."
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
  description = "Number of running tasks."
  type        = number
  default     = 1
}
