output "agent_runtime_arn" {
  description = "ARN of the AgentCore Runtime."
  value       = aws_bedrockagentcore_agent_runtime.this.agent_runtime_arn
}

output "agent_runtime_id" {
  description = "Id of the AgentCore Runtime."
  value       = aws_bedrockagentcore_agent_runtime.this.agent_runtime_id
}

output "memory_id" {
  description = "AgentCore Memory id."
  value       = aws_bedrockagentcore_memory.this.id
}

output "execution_role_arn" {
  description = "ARN of the AgentCore Runtime execution role."
  value       = aws_iam_role.runtime.arn
}

output "ecr_repository_url" {
  description = "URL of the ECR repo that holds the agent image."
  value       = aws_ecr_repository.agent.repository_url
}

output "agent_log_group_name" {
  description = "CloudWatch log group for agent application logs."
  value       = aws_cloudwatch_log_group.agent.name
}
