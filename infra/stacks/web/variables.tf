# ---------------------------------------------------------------------------
# Shared variables convention: region, project name, environment, tags.
# ---------------------------------------------------------------------------
variable "aws_region" {
  description = "AWS region for the S3 origin bucket (CloudFront itself is global)."
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
# Static origin bucket.
# ---------------------------------------------------------------------------
variable "bucket_suffix" {
  description = "Suffix that makes the static bucket name globally unique. Supplied as an input, never a literal."
  type        = string
}

# ---------------------------------------------------------------------------
# TLS / custom domain. Both are optional: with no ACM cert, the default
# CloudFront certificate and domain are used. The ACM cert must be in us-east-1.
# ---------------------------------------------------------------------------
variable "acm_certificate_arn" {
  description = "ARN of an ACM certificate in us-east-1 for the custom domain. Empty uses the default CloudFront certificate."
  type        = string
  default     = ""
}

variable "domain_names" {
  description = "Custom domain names (CNAMEs) for the distribution. Empty when using the default CloudFront domain."
  type        = list(string)
  default     = []
}

variable "price_class" {
  description = "CloudFront price class."
  type        = string
  default     = "PriceClass_100"
}

# ---------------------------------------------------------------------------
# WAF.
# ---------------------------------------------------------------------------
variable "waf_rate_limit" {
  description = "Rate-based rule limit: requests per 5-minute window per IP before blocking."
  type        = number
  default     = 2000
}
