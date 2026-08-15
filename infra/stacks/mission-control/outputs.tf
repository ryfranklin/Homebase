output "ecr_repository_url" {
  description = "ECR repo to build and push the Mission Control image to before the service can run."
  value       = aws_ecr_repository.this.repository_url
}

output "cluster_name" {
  description = "ECS cluster name (for ECS Exec / debugging)."
  value       = aws_ecs_cluster.this.name
}

output "service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.this.name
}

output "mission_control_url" {
  description = "Internal URL the BFF calls (Cloud Map DNS)."
  value       = "http://mission-control.${var.dns_namespace}:8000"
}

output "api_token_secret_arn" {
  description = "ARN of the generated BFF -> Mission Control bearer token (the api stack reads this for the BFF)."
  value       = aws_secretsmanager_secret.api_token.arn
}

output "db_endpoint" {
  description = "RDS endpoint (host) of the Mission Control ledger."
  value       = aws_db_instance.this.address
}
