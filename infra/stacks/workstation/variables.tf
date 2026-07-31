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
# Networking. The workstation gets its own dedicated private subnet (isolated
# from the endpoint-only Fargate subnets) plus a public subnet that holds only
# the NAT for outbound egress. From the foundation VPC (P2).
# ---------------------------------------------------------------------------
variable "vpc_id" {
  description = "VPC id from the foundation stack. This stack adds the VPC's internet gateway and egress path."
  type        = string
}

variable "az_index" {
  description = "Index into the region's availability zones for the workstation and NAT subnets."
  type        = number
  default     = 0
}

variable "workstation_subnet_cidr" {
  description = "CIDR for the workstation's dedicated private subnet."
  type        = string
  default     = "10.0.20.0/24"
}

variable "public_subnet_cidr" {
  description = "CIDR for the public subnet that holds only the NAT (no workstation)."
  type        = string
  default     = "10.0.21.0/24"
}

# ---------------------------------------------------------------------------
# Egress. Outbound-only. Parameterized so you can trade cost for convenience.
# ---------------------------------------------------------------------------
variable "nat_egress_type" {
  description = "Egress path: 'nat_instance' (a small EC2 that stops with the workstation, cheaper) or 'nat_gateway' (managed, always-on, pricier). Default is the stoppable option."
  type        = string
  default     = "nat_instance"

  validation {
    condition     = contains(["nat_instance", "nat_gateway"], var.nat_egress_type)
    error_message = "nat_egress_type must be 'nat_instance' or 'nat_gateway'."
  }
}

variable "nat_instance_type" {
  description = "Instance type for the NAT instance (when nat_egress_type = nat_instance)."
  type        = string
  default     = "t4g.nano"
}

# ---------------------------------------------------------------------------
# Instance and storage.
# ---------------------------------------------------------------------------
variable "instance_type" {
  description = "Workstation instance type (Graviton by default)."
  type        = string
  default     = "t4g.medium"
}

variable "root_volume_size" {
  description = "Encrypted root EBS volume size (GiB)."
  type        = number
  default     = 30
}

variable "home_volume_size" {
  description = "Encrypted persistent home EBS volume size (GiB)."
  type        = number
  default     = 50
}

variable "workstation_user" {
  description = "OS user whose home lives on the persistent volume and whose shell is bootstrapped."
  type        = string
  default     = "ec2-user"
}

# ---------------------------------------------------------------------------
# Dotfiles + secrets. The repo URL and the secret name are inputs, never
# committed. Secrets are pulled at session start, never baked into the AMI.
# ---------------------------------------------------------------------------
variable "dotfiles_repo_url" {
  description = "Git URL of your dotfiles repo, cloned at first boot. Supplied via git-ignored tfvars; stored in SSM, never committed. Empty skips dotfiles."
  type        = string
  default     = ""
}

variable "dotfiles_secret_name" {
  description = "Secrets Manager secret name holding your machine-local shell secrets (the ~/.zshrc.local pattern), pulled at session start."
  type        = string
  default     = "homebase/workstation/shell-secrets"
}

variable "assumable_role_arns" {
  description = "Task-specific role ARNs the instance role may assume for short-lived credentials. Broad operations use these, not standing instance permissions. Empty by default."
  type        = list(string)
  default     = []
}

# ---------------------------------------------------------------------------
# Auto-stop-when-idle. Neither a standing cost nor a standing target.
# ---------------------------------------------------------------------------
variable "auto_stop_mode" {
  description = "How the workstation stops: 'scheduled' (cron; also stops the NAT instance), 'activity' (stop the workstation on low CPU), or 'none'."
  type        = string
  default     = "scheduled"

  validation {
    condition     = contains(["scheduled", "activity", "none"], var.auto_stop_mode)
    error_message = "auto_stop_mode must be 'scheduled', 'activity', or 'none'."
  }
}

variable "stop_schedule" {
  description = "Schedule expression for scheduled auto-stop (EventBridge Scheduler)."
  type        = string
  default     = "cron(0 3 * * ? *)"
}

variable "idle_cpu_threshold" {
  description = "Activity mode: stop when average CPU percent stays below this."
  type        = number
  default     = 3
}

variable "idle_periods" {
  description = "Activity mode: number of consecutive 5-minute periods below the threshold before stopping."
  type        = number
  default     = 4
}
