output "distribution_domain_name" {
  description = "CloudFront distribution domain name (the app URL when no custom domain is set)."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "distribution_id" {
  description = "CloudFront distribution id (for cache invalidations)."
  value       = aws_cloudfront_distribution.this.id
}

output "static_bucket_name" {
  description = "Name of the private static origin bucket (upload the SPA build here)."
  value       = aws_s3_bucket.static.id
}

output "web_acl_arn" {
  description = "ARN of the WAF web ACL."
  value       = aws_wafv2_web_acl.this.arn
}
