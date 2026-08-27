# Security Policy

Homebase is a PUBLIC repository. Every committed file is world-readable. This document describes how
secrets are handled and how to report a security issue.

## How secrets are handled

No account IDs, ARNs, IAM principal names, emails, real domains, Cognito/Google/Slack identifiers or
tokens, API keys, Terraform state, or `.env` files are ever committed.

Every environment-specific or secret value is an input, never a literal in code:

- Terraform variables, with a committed `*.tfvars.example` (fake placeholders) and the real
  `*.tfvars` git-ignored.
- Runtime environment variables.
- AWS Secrets Manager secrets (for secret material such as OAuth client secrets and tokens).
- SSM Parameter Store SecureStrings (for configuration that may be sensitive).

Defense in depth against accidental disclosure:

- `.gitignore` excludes `.env` files, `*.tfvars`, `*.tfstate`, private keys, `.aws/`, and generic
  secret and credential file patterns.
- A pre-commit hook chain runs gitleaks (secret scanning), `terraform fmt`, whitespace fixers, and a
  local hook that blocks committing files whose names match secret patterns.
- CI runs a gitleaks secret scan on every push and pull request and fails on any finding.
- CI runs a Checkov IaC security scan over `infra/` Terraform. It is gated against a committed
  baseline (`infra/.checkov.baseline`) so it stays green on the current, audit-reviewed state and fails
  the build only on NEW misconfigurations a change introduces (for example a fresh `0.0.0.0/0` security
  group or an unencrypted new bucket). Refresh the baseline after intentional infra changes with
  `checkov -d infra --framework terraform --create-baseline --soft-fail`.

Infrastructure is never auto-applied by an agent. Agents may run `terraform fmt`, `terraform
validate`, and `terraform plan` only. A human runs `terraform apply`.

## Platform security controls

Beyond secret hygiene, the deployed platform applies defense in depth:

- **Identity**: Cognito with short-lived access/id tokens (60 min) and a 7-day refresh token with
  refresh-token ROTATION (each refresh token is single-use). Self-sign-up is fail-closed by default (an
  allow-list gate; an empty list admits nobody). MFA (TOTP) is available.
- **Edge**: CloudFront + WAF is the only public ingress; the BFF Function URL is gated by a rotating
  origin shared secret and in-function Cognito JWT verification. Response security headers (HSTS,
  X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy) are always sent, with an opt-in
  Content-Security-Policy.
- **Network**: a private-only VPC (no public IPs on workloads), the workstation reachable over SSM only
  (no public SSH), and VPC flow logs for network-level forensics.
- **Data**: KMS CMKs across S3, RDS, EBS, secrets, and logs; buckets block public access and deny
  non-TLS access; connector data is fetched live and never indexed.
- **Connectors**: read-first, write-gated (writes require an explicit confirmation), per-tenant token
  isolation. The web-search connector authenticates with a single API key and delegates page fetching
  to the vendor's server-side extract, so no arbitrary-URL fetch leaves our Lambda (SSRF containment),
  on a dedicated minimal IAM role.
- **Audit**: a multi-region CloudTrail management-plane trail (log-file validation on) to a KMS'd,
  locked-down bucket.
- **Model**: a Bedrock Guardrail on every Converse call; only read tools are exposed to the model, and
  connector/web content is treated as untrusted data, not instructions.

## If you find a secret in the history

Treat any committed secret as compromised. Rotate it immediately (Secrets Manager, the Google OAuth
console, Cognito, or the relevant provider), then remove it from history. Rotation comes first;
history rewriting second.

## Reporting a vulnerability

Please report suspected vulnerabilities privately using GitHub's
[private security advisories](https://docs.github.com/en/code-security/security-advisories) on this
repository ("Report a vulnerability" under the Security tab). Do not open a public issue for
security problems.

Include a description, reproduction steps, and impact. We will acknowledge the report and work on a
fix. Please allow reasonable time for remediation before any public disclosure.
