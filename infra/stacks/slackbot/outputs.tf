output "ecr_repository_url" {
  description = "URL of the ECR repo to build and push the Slack bridge image to before the service can run."
  value       = aws_ecr_repository.this.repository_url
}

output "cluster_name" {
  description = "ECS cluster name (for aws ecs execute-command / debugging)."
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

output "allowlist_param_name" {
  description = "Name of the by-hand SSM SecureString the bridge reads for the Slack allow-list. Create it before relying on the gate."
  value       = local.allowlist_param_name
}
