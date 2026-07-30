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

Infrastructure is never auto-applied by an agent. Agents may run `terraform fmt`, `terraform
validate`, and `terraform plan` only. A human runs `terraform apply`.

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
