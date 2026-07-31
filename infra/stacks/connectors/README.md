# stacks/connectors

The connector layer (ADR-004): an AgentCore Gateway exposing the six connectors as MCP tools, and
AgentCore Identity holding each connector's OAuth credentials. State lives remotely in the bootstrap
bucket.

## What it creates

- An AgentCore Gateway (MCP), authorized by the same Cognito JWT the GUI and CLI carry, so per-tenant
  scoping is consistent across the whole system. KMS-encrypted.
- Four AgentCore Identity OAuth2 credential providers (Google, Slack, QuickBooks, Atlassian). Google
  backs Gmail, Calendar, and Drive. Client secrets use write-only args (not stored in state); client
  ids come from git-ignored tfvars. Homebase authenticates each connector independently: it does not
  reuse any other app's tokens.
- Six Gateway targets (one per connector), each attaching its OAuth provider with READ-FIRST scopes
  and routing to the connector's shim Lambda. Write tools are added only where a gated write exists;
  no write scope is requested here.

## Read-first and write-gated

The scopes requested here are read-only. The write-confirmation gate lives at the tool layer
(`services/connectors`), so a write returns a confirmation contract rather than executing, and both
front doors (GUI and CLI) inherit it.

## Nothing indexed (ADR-004)

There is no connector-to-corpus path anywhere in this stack or in `services/connectors`. Connector
data is fetched live per query and never written into the S3 Vectors store.

## Initialize and validate (human runs apply, agents do not)

```bash
cp backend.hcl.example backend.hcl             # edit with bootstrap outputs
cp terraform.tfvars.example terraform.tfvars   # edit with real values from docs/connectors.md
terraform -chdir=infra/stacks/connectors init -backend-config=backend.hcl
terraform -chdir=infra/stacks/connectors plan
```

The `credential_provider_vendor` values and OIDC discovery URLs should be confirmed against the
current AgentCore Identity API for your region before apply. Agents may run `fmt`, `validate`, and
`plan` only. A human runs `apply`.
