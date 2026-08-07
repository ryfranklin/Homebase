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
- An optional sign-up allow-list gate: a Pre-Sign-Up Lambda that restricts who can create an account
  (see below). Created only when `enable_signup_allowlist = true`.

## Sign-up allow-list (interim access gate)

By default a Cognito user pool with a hosted UI is open: anyone who reaches the URL can self-register
a native email/password account, and Google federation auto-provisions an account for any Google user
on first sign-in. Since the BFF authorizes on any valid token from this pool, open sign-up means open
access to the agent (and, once ingested, the knowledge base).

The allow-list closes that. Set `enable_signup_allowlist = true` (in the git-ignored
`terraform.tfvars`). When enabled, `allowlist.tf` creates a **Pre-Sign-Up Lambda**
(`presignup/allowlist.py`) and wires it to the pool via `lambda_config.pre_sign_up`. Cognito invokes it
before creating any account, so it gates **both** paths:

- native self sign-up (`PreSignUp_SignUp`), and
- first-time Google federation (`PreSignUp_ExternalProvider`).

Any email not on the list is rejected with an "invite-only" message. Existing accounts are unaffected
(the trigger fires only at account creation). When `enable_signup_allowlist` is false (the default), no
trigger is created and the pool stays open.

### The allow-list value is a by-hand SecureString, never in Terraform

The list of allowed emails is PII, so it is **not** stored in Terraform state, plans, or tfvars, and
never in this repo. It lives only in a **by-hand SSM Parameter Store SecureString** (KMS-encrypted).
Terraform references it by **name only** (in the Lambda env var `ALLOWED_EMAILS_PARAM` and in a scoped
`ssm:GetParameter` + via-SSM `kms:Decrypt` policy); the Lambda reads and decrypts it at runtime.

Create or update it out-of-band (comma-separated, **every** address you sign in with — your Google
login and any native email):

```bash
aws ssm put-parameter --type SecureString --overwrite \
  --name /homebase/<env>/identity/allowed-signup-emails \
  --value "you@example.com,other@example.com" --region <region>
```

The Lambda **fails closed**: if the parameter is missing or unreadable, every sign-up is denied. So
create the parameter before relying on the gate (existing accounts, including yours, are unaffected
either way).

**Evolution.** This is a deliberately simple gate for the single-tenant seed: a flat email allow-list,
enforced at sign-up. As Homebase grows toward the multi-tenant platform, this is expected to be
replaced by **AWS IAM Identity Center** (centralized SSO, groups, and permission sets) so access is
managed by directory membership and assignments rather than an inline email list. The `tenant_id`
attribute already on the pool is the seam that keeps that door open. Until then, the allow-list is the
access control.

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
