output "bff_function_url" {
  description = "The Lambda Function URL for the streaming BFF (the CloudFront /api/* origin in P8)."
  value       = aws_lambda_function_url.bff.function_url
}

output "bff_function_name" {
  description = "Name of the BFF Lambda function."
  value       = aws_lambda_function.bff.function_name
}

output "bff_function_arn" {
  description = "ARN of the BFF Lambda function."
  value       = aws_lambda_function.bff.arn
}

output "function_url_auth_type" {
  description = "The Function URL auth type in effect (NONE or AWS_IAM)."
  value       = var.function_url_auth_type
}

output "oac_id" {
  description = "CloudFront OAC id (only when auth type is AWS_IAM), for the P8 distribution."
  value       = var.function_url_auth_type == "AWS_IAM" ? aws_cloudfront_origin_access_control.bff[0].id : null
}
