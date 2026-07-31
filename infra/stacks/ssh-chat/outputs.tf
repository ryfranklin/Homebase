output "cluster_name" {
  description = "ECS cluster name (for aws ecs execute-command)."
  value       = aws_ecs_cluster.this.name
}

output "service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.this.name
}

output "task_role_arn" {
  description = "ARN of the least-privilege task role."
  value       = aws_iam_role.task.arn
}

output "ecr_repository_url" {
  description = "URL of the ECR repo that holds the CLI image."
  value       = aws_ecr_repository.cli.repository_url
}
