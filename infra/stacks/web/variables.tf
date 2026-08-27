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
  description = "Rate-based rule limit: requests per 5-minute window per IP before blocking. Kept generous so a phone behind carrier-grade NAT and the single-request SSE stream are not throttled."
  type        = number
  default     = 3000
}

variable "waf_geo_allowed_countries" {
  description = "Optional ISO country allowlist. When non-empty, requests from other countries are blocked. Empty (default) applies no geo constraint."
  type        = list(string)
  default     = []
}

variable "waf_common_rules_count_only" {
  description = "Names of AWSManagedRulesCommonRuleSet rules to set to COUNT instead of BLOCK, to avoid false positives on legitimate mobile use or chat POST bodies (for example SizeRestrictions_BODY). Tune as needed."
  type        = list(string)
  default     = []
}

# ---------------------------------------------------------------------------
# Response security headers (H2 hardening). HSTS / nosniff / frame-DENY /
# referrer-policy are always emitted (safe, non-breaking). A Content-Security-
# Policy is OPT-IN via this variable because a wrong CSP can break the SPA (it
# must permit the Cognito hosted-UI token endpoint in connect-src and inline
# styles for Markdown/Mermaid). Empty (default) emits no CSP header. A known-good
# starting point (fill in your hosted-UI origin) is:
#   default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
#   img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self';
#   frame-ancestors 'none'; form-action 'self' https://<hosted-ui-domain>;
#   connect-src 'self' https://<hosted-ui-domain>
# ---------------------------------------------------------------------------
variable "content_security_policy" {
  description = "Content-Security-Policy header value for the SPA. Empty emits no CSP (safe default); set a tested value to enforce one. Must allow the Cognito hosted-UI origin in connect-src/form-action."
  type        = string
  default     = ""
}
