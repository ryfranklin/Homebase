output "ecr_repository_url" {
  description = "ECR repository for the eval batch runner image."
  value       = aws_ecr_repository.this.repository_url
}

output "cluster_name" {
  description = "ECS cluster that runs the eval task."
  value       = aws_ecs_cluster.this.name
}

output "task_definition_arn" {
  description = "Task definition launched on demand by scripts/run-eval.sh."
  value       = aws_ecs_task_definition.this.arn
}

output "results_table_name" {
  description = "DynamoDB table holding the run ledger and per-case scores."
  value       = aws_dynamodb_table.results.name
}

output "artifacts_bucket" {
  description = "S3 bucket holding raw prompt/response artifacts."
  value       = aws_s3_bucket.artifacts.bucket
}

output "pricing_parameter_name" {
  description = "SSM parameter holding the pricing table the runner reads at run time."
  value       = local.pricing_param_name
}

output "dashboard_name" {
  description = "CloudWatch dashboard with quality, latency, and cost per model."
  value       = aws_cloudwatch_dashboard.this.dashboard_name
}
