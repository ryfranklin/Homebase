output "state_bucket_name" {
  description = "Name of the S3 state bucket. Use as 'bucket' in the foundation backend.hcl."
  value       = aws_s3_bucket.state.id
}

output "state_bucket_arn" {
  description = "ARN of the S3 state bucket."
  value       = aws_s3_bucket.state.arn
}

output "lock_table_name" {
  description = "Name of the DynamoDB lock table. Use as 'dynamodb_table' in the foundation backend.hcl."
  value       = aws_dynamodb_table.locks.name
}

output "state_kms_key_arn" {
  description = "ARN of the KMS key encrypting state. Use as 'kms_key_id' in the foundation backend.hcl."
  value       = module.state_kms.key_arn
}

output "region" {
  description = "Region of the backend resources. Use as 'region' in the foundation backend.hcl."
  value       = var.aws_region
}
