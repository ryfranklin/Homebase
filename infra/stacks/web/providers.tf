provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

# CloudFront WAF (WAFv2 scope = CLOUDFRONT) and ACM certificates for CloudFront
# must be created in us-east-1. This is an AWS requirement, not a deployment
# region choice, so the region is fixed here rather than taken from a variable.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = local.common_tags
  }
}
