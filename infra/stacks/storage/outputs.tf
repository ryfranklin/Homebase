output "corpus_bucket_name" {
  description = "Name of the source corpus S3 bucket."
  value       = aws_s3_bucket.corpus.id
}

output "corpus_bucket_arn" {
  description = "ARN of the source corpus S3 bucket."
  value       = aws_s3_bucket.corpus.arn
}

output "corpus_kms_key_arn" {
  description = "ARN of the KMS key encrypting the corpus."
  value       = module.corpus_kms.key_arn
}
