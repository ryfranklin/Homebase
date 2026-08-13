output "ecr_repository_url" {
  description = "ECR repo to build and push the vault-worker image to before the service can run."
  value       = aws_ecr_repository.worker.repository_url
}

output "cluster_name" {
  description = "ECS cluster name (for ECS Exec / debugging)."
  value       = aws_ecs_cluster.this.name
}

output "service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.this.name
}

output "worker_secret_arn" {
  description = "ARN of the generated BFF -> worker shared secret (wired to the BFF in a later step)."
  value       = aws_secretsmanager_secret.worker_secret.arn
}
