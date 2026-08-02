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
