# infra/modules/

Reusable Terraform modules. Each module owns a single concern and exposes variables for every
environment-specific or secret value. No hardcoded account IDs, ARNs, domains, or secrets.

Planned modules include networking, Cognito with Google federation, Bedrock Knowledge Base with
S3 Vectors, AgentCore runtime, CloudFront plus SPA hosting, the API Gateway plus Lambda BFF, the
EC2 workstation (reached via SSM), and the connector MCP tools (via AgentCore Gateway and Identity).
