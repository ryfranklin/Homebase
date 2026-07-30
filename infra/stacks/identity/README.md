# stacks/identity

Authentication for Homebase: a Cognito user pool with Google federation and a public SPA app client.
It stores its state remotely in the bootstrap S3 bucket and lock table.

## What it creates

- A Cognito user pool: email as the primary attribute, MFA available (TOTP), a strong password
  policy, and a custom `tenant_id` attribute so tenant identity stays explicit in the data model.
- A Google identity provider. The client id and secret are inputs, never hardcoded (see below).
- A public SPA app client: authorization code flow with PKCE, no client secret in the browser,
  callback and logout URLs from variables.
- A hosted UI domain (prefix from a variable).
- SSM `String` parameters for the non-secret identifiers (pool id, app client id, issuer, hosted UI
  domain) so later stacks and the BFF can read them. Nothing secret is written to SSM.

## Google credentials: two supported sources

The Google OAuth client id and secret are never committed. Configure one of:

1. Secrets Manager (default, preferred): set `google_client_secret_source = "secrets_manager"` and
   `google_client_secret_name`. Terraform reads the secret by reference at apply time. The client id
   is still supplied via git-ignored tfvars (low sensitivity, but out of a public repo).
2. Variable: set `google_client_secret_source = "variable"` and `google_client_secret` in
   git-ignored tfvars. Use only where Secrets Manager is not available.

See `../../../docs/identity.md` for the by-hand Google Cloud Console setup.

## Initialize and validate (human runs apply, agents do not)

```bash
cp backend.hcl.example backend.hcl             # edit with bootstrap outputs
cp terraform.tfvars.example terraform.tfvars   # edit with real values
terraform -chdir=infra/stacks/identity init -backend-config=backend.hcl
terraform -chdir=infra/stacks/identity plan
```

Agents may run `fmt`, `validate`, and `plan` only. A human runs `apply`.
