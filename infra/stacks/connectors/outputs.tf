output "gateway_id" {
  description = "AgentCore Gateway id."
  value       = aws_bedrockagentcore_gateway.this.gateway_id
}

output "gateway_url" {
  description = "AgentCore Gateway MCP URL."
  value       = aws_bedrockagentcore_gateway.this.gateway_url
}

output "gateway_role_arn" {
  description = "ARN of the Gateway execution role."
  value       = aws_iam_role.gateway.arn
}

output "credential_provider_arns" {
  description = "ARNs of the per-vendor OAuth2 credential providers."
  value = {
    google    = aws_bedrockagentcore_oauth2_credential_provider.google.credential_provider_arn
    slack     = aws_bedrockagentcore_oauth2_credential_provider.slack.credential_provider_arn
    atlassian = aws_bedrockagentcore_oauth2_credential_provider.atlassian.credential_provider_arn
  }
}
