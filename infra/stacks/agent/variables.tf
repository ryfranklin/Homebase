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
# Model. Model id is a variable so Opus vs Sonnet is a config change, not code.
# ---------------------------------------------------------------------------
variable "model_id" {
  description = "Bedrock model id the agent invokes (for example a Claude model id or inference profile)."
  type        = string
  default     = "anthropic.claude-placeholder-model-id"
}

variable "agent_timezone" {
  description = "IANA timezone the agent resolves 'today'/'now' in (for example America/Chicago). Falls back to UTC when unset."
  type        = string
  default     = "UTC"
}

variable "additional_model_arns" {
  description = "Extra Bedrock model/inference-profile ARNs the agent may invoke (for example a cross-region inference profile). Kept least-privilege: empty by default."
  type        = list(string)
  default     = []
}

# ---------------------------------------------------------------------------
# Container image for the AgentCore Runtime. The image is built from
# services/agent and pushed to the ECR repo this stack creates.
# ---------------------------------------------------------------------------
variable "agent_image_tag" {
  description = "Tag of the agent container image in the ECR repo this stack creates."
  type        = string
  default     = "latest"
}

variable "runtime_network_mode" {
  description = "AgentCore Runtime network mode (PUBLIC or a VPC mode)."
  type        = string
  default     = "PUBLIC"
}

variable "runtime_server_protocol" {
  description = "AgentCore Runtime server protocol (HTTP for the /invocations + /ping contract)."
  type        = string
  default     = "HTTP"
}

# ---------------------------------------------------------------------------
# Memory.
# ---------------------------------------------------------------------------
variable "memory_event_expiry_days" {
  description = "Short-term memory retention in days (3-365)."
  type        = number
  default     = 30
}

variable "enable_long_term_memory" {
  description = "Whether to create a long-term memory extraction strategy."
  type        = bool
  default     = true
}

variable "long_term_memory_strategy_type" {
  description = "Long-term memory strategy type (for example SEMANTIC, SUMMARIZATION, USER_PREFERENCE)."
  type        = string
  default     = "SEMANTIC"
}

variable "long_term_memory_namespaces" {
  description = "Namespace templates for long-term memory records. The {actorId} placeholder keeps records isolated per actor (tenant/user), so memory never crosses tenants."
  type        = list(string)
  default     = ["homebase/{actorId}"]
}

# ---------------------------------------------------------------------------
# Observability.
# ---------------------------------------------------------------------------
variable "enable_transaction_search_log_policy" {
  description = "Create the CloudWatch Logs resource policy that lets X-Ray deliver trace spans (a prerequisite for CloudWatch Transaction Search / GenAI Observability)."
  type        = bool
  default     = true
}
