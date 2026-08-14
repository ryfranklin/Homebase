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
  description = "ARN of the generated BFF -> worker shared secret."
  value       = aws_secretsmanager_secret.worker_secret.arn
}

output "worker_url" {
  description = "Internal URL the BFF calls (Cloud Map DNS)."
  value       = "http://worker.${var.dns_namespace}:8080"
}

output "client_security_group_id" {
  description = "SG the BFF attaches to so the worker can allow it in by reference."
  value       = aws_security_group.client.id
}

output "private_subnet_id" {
  description = "Private subnet the BFF's VPC config should use (egresses via the NAT)."
  value       = aws_subnet.private.id
}
