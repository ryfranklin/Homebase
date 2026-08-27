variable "name" {
  description = "Name prefix for VPC resources."
  type        = string
}

variable "cidr_block" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones for the private subnets. One subnet is created per zone."
  type        = list(string)
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for the private subnets. Must align 1:1 with availability_zones."
  type        = list(string)
}

variable "gateway_endpoints" {
  description = "Gateway VPC endpoints to create (no hourly cost)."
  type        = list(string)
  default     = ["s3"]
}

variable "interface_endpoints" {
  description = "Interface VPC endpoints to create for the services the platform uses."
  type        = list(string)
  default = [
    "ssm",
    "ssmmessages",
    "ec2messages",
    "ecr.api",
    "ecr.dkr",
    "logs",
    "bedrock-runtime",
    "bedrock-agent-runtime",
    "bedrock-agentcore",
  ]
}

variable "tags" {
  description = "Tags applied to all resources in the module."
  type        = map(string)
  default     = {}
}

variable "enable_flow_logs" {
  description = "Emit VPC flow logs (traffic_type ALL) to CloudWatch Logs for network-level audit/forensics. On by default."
  type        = bool
  default     = true
}

variable "flow_log_retention_days" {
  description = "Retention for the VPC flow-log CloudWatch Logs group."
  type        = number
  default     = 90
}

variable "flow_log_kms_key_arn" {
  description = "Optional KMS key ARN to encrypt the flow-log group. Null uses CloudWatch Logs default encryption."
  type        = string
  default     = null
}
