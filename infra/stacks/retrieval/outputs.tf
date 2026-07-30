output "knowledge_base_id" {
  description = "Bedrock Knowledge Base id."
  value       = aws_bedrockagent_knowledge_base.this.id
}

output "knowledge_base_arn" {
  description = "Bedrock Knowledge Base ARN."
  value       = aws_bedrockagent_knowledge_base.this.arn
}

output "data_source_id" {
  description = "Bedrock data source id for the corpus bucket."
  value       = aws_bedrockagent_data_source.corpus.data_source_id
}

output "vector_bucket_arn" {
  description = "ARN of the S3 Vectors vector bucket."
  value       = aws_s3vectors_vector_bucket.this.vector_bucket_arn
}

output "vector_index_name" {
  description = "Name of the S3 Vectors index."
  value       = aws_s3vectors_index.this.index_name
}

output "kb_role_arn" {
  description = "ARN of the Bedrock KB service role."
  value       = aws_iam_role.kb.arn
}

output "rerank_model_id" {
  description = "Rerank model id used at query time."
  value       = var.rerank_model_id
}

output "default_search_type" {
  description = "Default search type (SEMANTIC on S3 Vectors; HYBRID needs the OSS fallback)."
  value       = var.default_search_type
}
