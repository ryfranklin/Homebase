# Secrets: rotation versus refresh

Homebase has two kinds of credential, and they are handled differently. This note keeps the
distinction honest so the docs do not imply rotation that does not happen.

## Rotatable secrets: Secrets Manager rotation

Generated single-value secrets that a service reads at runtime get true Secrets Manager rotation.

### The CloudFront origin shared secret

This is the value CloudFront injects as `X-Origin-Secret` and the BFF checks (closing the WAF-bypass
hole from P8). It is generated in the api stack and rotated automatically:

- `aws_secretsmanager_secret_rotation` runs the rotation Lambda (`infra/stacks/api/rotation/`) every
  `origin_secret_rotation_days`.
- Because the secret lives in two places (Secrets Manager and the static CloudFront custom header),
  rotation is two-sided: the Lambda generates a new pending value, updates the CloudFront header to
  it, then promotes it to current.
- The BFF reads the secret from Secrets Manager at runtime and accepts BOTH the current and pending
  values during the window, so the header update and the promotion need not be atomic and there is no
  redeploy.

Any other generated credential we own follows the same pattern.

## Non-rotatable secrets: refresh, not rotation

### Connector OAuth tokens (Gmail, Calendar, Drive, Slack, QuickBooks, Atlassian)

These are NOT rotated by Secrets Manager. They are OAuth access/refresh tokens held in AgentCore
Identity, and AgentCore Identity handles their lifecycle: it refreshes an expired access token using
the stored refresh token. We do not run a Secrets Manager rotation schedule against them, and this
doc does not claim to. If a token is revoked or the OAuth app credentials change, you re-authorize the
connector (see [connectors.md](./connectors.md)); AgentCore Identity stores the new token.

### The OAuth app client secrets (per connector)

The client secrets you register per connector (the app's own secret, not a user token) are supplied
via git-ignored tfvars and stored by AgentCore Identity. Rotating one means updating it at the
provider and bumping the corresponding `*_secret_version` variable, then re-applying. That is a
deliberate operator action, not an automatic schedule.

### The Tavily web-search API key

The `web` connector authenticates to Tavily with a single API key (not a per-user token). It is a
by-hand Secrets Manager secret whose NAME is passed as `tavily_secret_name`; the web shim reads it at
runtime via a dedicated, minimal IAM role. It is not on a Secrets Manager rotation schedule: rotating
it means creating a new key at Tavily and updating the secret value. Leaving `tavily_secret_name` empty
disables the connector.

## Summary

| Secret | Mechanism |
| --- | --- |
| CloudFront origin shared secret | Secrets Manager rotation (Lambda, two-sided, 30 days) |
| Other generated single-value secrets | Secrets Manager rotation |
| Connector OAuth user tokens | Refreshed by AgentCore Identity (not rotated) |
| Connector OAuth app client secrets | Operator-rotated (update provider + bump version + apply) |
| Tavily web-search API key | Operator-managed by-hand secret (create new key + update secret value) |
| Cognito SPA refresh token | Rotated by Cognito on every refresh (single-use), 7-day lifetime |
