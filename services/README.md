# services/

Backend services for Homebase.

- `agent/`: the AgentCore agent runtime. Orchestrates retrieval and tool calls, and talks to
  Bedrock. Reads configuration from environment variables and resolved Terraform outputs.
- `bff/`: the backend for frontend, deployed as API Gateway plus Lambda. Fronts the SPA, enforces
  Cognito authorization, and calls the agent.
- `ingestion/`: the pipeline that loads and updates the Bedrock Knowledge Base (with S3 Vectors)
  from source documents.
- `connectors/`: six connectors exposed as MCP tools via AgentCore Gateway and AgentCore Identity.

## Conventions

- No secrets or account-specific values in code. Read them from environment variables, AWS Secrets
  Manager, or SSM Parameter Store.
- Keep tenant identity and user identity explicit in every data model, even while single-tenant.
