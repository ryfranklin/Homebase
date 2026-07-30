data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  common_tags = merge({
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = "foundation"
  }, var.tags)

  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  # Carve one /24 per AZ out of the VPC CIDR without committing any AZ names.
  private_subnet_cidrs = [for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, 8, i)]
}

# Customer managed key for storage and logs encryption across the platform.
module "kms" {
  source = "../../modules/kms"

  alias       = "${var.project_name}-${var.environment}"
  description = "Homebase ${var.environment} key for storage and logs encryption"
  service_principals = [
    "logs.amazonaws.com",
    "sns.amazonaws.com",
    "budgets.amazonaws.com",
    "cloudwatch.amazonaws.com",
  ]
  tags = local.common_tags
}

# Private-only network with the VPC endpoints the services will need.
module "vpc" {
  source = "../../modules/vpc"

  name                 = "${var.project_name}-${var.environment}"
  cidr_block           = var.vpc_cidr
  availability_zones   = local.azs
  private_subnet_cidrs = local.private_subnet_cidrs
  tags                 = local.common_tags
}
