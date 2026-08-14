# ---------------------------------------------------------------------------
# Shared convention: region, project name, environment, tags.
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
  description = "Additional tags merged onto the common tag set."
  type        = map(string)
  default     = {}
}

# ---------------------------------------------------------------------------
# Networking. The worker needs OUTBOUND internet (to reach GitHub over HTTPS),
# which the endpoint-only Fargate subnets do not have, so it runs in its own
# public subnet routed to the VPC's existing internet gateway, with a public IP
# for egress and a security group that allows NO inbound.
# ---------------------------------------------------------------------------
variable "vpc_id" {
  description = "The foundation VPC id (same value the workstation stack uses)."
  type        = string
}

variable "public_subnet_cidr" {
  description = "CIDR for the public subnet that holds only the NAT instance. Must not overlap foundation or workstation subnets."
  type        = string
  default     = "10.0.30.0/24"
}

variable "private_subnet_cidr" {
  description = "CIDR for the private subnet where the worker (and, egressing through the NAT, the BFF) run. Must not overlap other subnets."
  type        = string
  default     = "10.0.31.0/24"
}

variable "nat_instance_type" {
  description = "Instance type for the always-on NAT instance (egress for the worker + BFF). t4g.nano is cheapest."
  type        = string
  default     = "t4g.nano"
}

variable "dns_namespace" {
  description = "Private DNS namespace for service discovery (the worker registers as worker.<namespace>)."
  type        = string
  default     = "homebase.internal"
}

# ---------------------------------------------------------------------------
# The vault git repo and its access token.
# ---------------------------------------------------------------------------
variable "github_repo_url" {
  description = "HTTPS clone URL of the private vault repo, for example https://github.com/OWNER/REPO.git."
  type        = string
}

variable "vault_branch" {
  description = "Branch the worker tracks."
  type        = string
  default     = "main"
}

variable "github_token_secret_name" {
  description = "Name of a BY-HAND Secrets Manager secret holding a GitHub fine-grained PAT with Contents read/write on the vault repo. The token is never committed; the worker reads it as an injected env var."
  type        = string
}

variable "git_committer_name" {
  description = "Git committer name for merge/rebase commits the worker makes."
  type        = string
  default     = "Homebase"
}

variable "git_committer_email" {
  description = "Git committer email for merge/rebase commits the worker makes."
  type        = string
  default     = "homebase@localhost"
}

# ---------------------------------------------------------------------------
# Task sizing and image.
# ---------------------------------------------------------------------------
variable "image_tag" {
  description = "Tag of the vault-worker image in ECR to run."
  type        = string
  default     = "latest"
}

variable "task_cpu" {
  description = "Fargate task CPU units."
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "Fargate task memory (MiB)."
  type        = number
  default     = 1024
}

variable "task_cpu_architecture" {
  description = "CPU architecture. The image must be built for this platform."
  type        = string
  default     = "ARM64"
}

variable "pull_interval_ms" {
  description = "How often the worker pulls external commits and re-mirrors."
  type        = number
  default     = 60000
}
