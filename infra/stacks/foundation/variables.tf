# ---------------------------------------------------------------------------
# Shared variables convention: region, project name, environment, tags.
# ---------------------------------------------------------------------------
variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
}

variable "project_name" {
  description = "Project name, used as a prefix for resource names and the KMS alias."
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
# Cost guardrail (AWS Budgets + SNS).
# ---------------------------------------------------------------------------
variable "monthly_budget_amount" {
  description = "Monthly cost budget limit."
  type        = number
  default     = 100
}

variable "budget_currency" {
  description = "Currency for the budget limit."
  type        = string
  default     = "USD"
}

variable "budget_alert_emails" {
  description = "Email addresses subscribed to budget alerts. Supplied as an input, never a literal."
  type        = list(string)
  default     = []
}

variable "budget_alert_thresholds" {
  description = "Percentage-of-budget thresholds that trigger an alert."
  type        = list(number)
  default     = [50, 80, 100]
}

# ---------------------------------------------------------------------------
# Networking.
# ---------------------------------------------------------------------------
variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones (and private subnets) to span."
  type        = number
  default     = 2
}
