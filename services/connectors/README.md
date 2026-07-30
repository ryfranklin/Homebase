# services/connectors/

Six connectors exposed as MCP tools via AgentCore Gateway and AgentCore Identity. Each connector
wraps an external system and presents a typed tool surface the agent can call.

- OAuth client ids are public inputs; client secrets and tokens live in AWS Secrets Manager.
- No provider identifiers, tokens, or endpoints as literals in code.
- Each tool call carries tenant and user identity so access stays scoped and auditable.
