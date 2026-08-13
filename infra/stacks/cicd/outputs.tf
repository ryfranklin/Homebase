output "web_deploy_role_arn" {
  description = "ARN of the web-deploy role. Set this as the GitHub Actions repo secret AWS_DEPLOY_ROLE_ARN."
  value       = aws_iam_role.web_deploy.arn
}

output "github_oidc_provider_arn" {
  description = "ARN of the GitHub Actions OIDC provider in use (created here, or the one passed in)."
  value       = local.oidc_provider_arn
}
