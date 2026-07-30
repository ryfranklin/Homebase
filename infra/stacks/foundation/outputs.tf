output "vpc_id" {
  description = "The foundation VPC id."
  value       = module.vpc.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet ids for downstream stacks."
  value       = module.vpc.private_subnet_ids
}

output "endpoints_security_group_id" {
  description = "Security group protecting the interface VPC endpoints."
  value       = module.vpc.endpoints_security_group_id
}

output "kms_key_arn" {
  description = "ARN of the storage and logs encryption key."
  value       = module.kms.key_arn
}

output "kms_key_id" {
  description = "Id of the storage and logs encryption key."
  value       = module.kms.key_id
}

output "budget_name" {
  description = "Name of the monthly cost budget."
  value       = aws_budgets_budget.monthly.name
}

output "budget_sns_topic_arn" {
  description = "ARN of the SNS topic that receives budget alerts."
  value       = aws_sns_topic.budget_alerts.arn
}
