# CLAUDE.md

This is the first file every future session reads. It encodes the conventions for the Homebase
repository. Read it fully before making any change.

## What Homebase is

Homebase is a personal AI pipeline: an authenticated web GUI plus an SSH plane over a private
knowledge base, running on AWS and Anthropic-native. It is the single-tenant seed of a future
multi-tenant platform.

## Repository is PUBLIC

Treat every committed file as world-readable. Assume anything you commit is permanently public,
even if later deleted.

Never commit any of the following:

- AWS account IDs, ARNs, or IAM principal names
- Email addresses or real domain names
- Cognito, Google, or Slack identifiers, client IDs, or tokens
- API keys, passwords, or any secret material
- Terraform state (`*.tfstate`) or `.env` files
- Private keys (`*.pem`, `*.key`) or credential files

If you are unsure whether a value is sensitive, treat it as sensitive and keep it out of the repo.

## Everything environment-specific or secret is an INPUT

No account, domain, or secret value is ever a literal in code. Every such value enters the system
as one of these inputs:

- A Terraform variable, with a committed `*.tfvars.example` (placeholder values) and the real
  `*.tfvars` kept git-ignored
- A runtime environment variable
- An AWS Secrets Manager secret
- An SSM Parameter Store SecureString

Code reads from these inputs at build or run time. It never hardcodes the value.

## Terraform is never auto-applied by an agent

Agents may run `terraform fmt`, `terraform validate`, and `terraform plan` only. Applying
infrastructure changes is a human action. Never run `terraform apply`, `terraform destroy`, or any
command that mutates cloud state. The human runs apply.

## Stack summary

- Agent runtime on Amazon Bedrock AgentCore
- Retrieval via Bedrock Knowledge Base with S3 Vectors, using hybrid retrieval
- Authentication via Amazon Cognito with Google federation
- Web GUI as a React SPA served from CloudFront
- Backend for frontend (BFF) as API Gateway plus Lambda
- A thin chat CLI running as a Fargate container
- A separate EC2 workstation reached over SSM (no public SSH)
- Six per-user OAuth connectors, plus an optional no-OAuth web-search connector (Tavily), exposed as
  MCP tools via AgentCore Gateway and AgentCore Identity
- An on-demand evaluation harness that benchmarks many Bedrock models (quality, latency, cost, task
  success) over the Converse API, so model choice per seam is made on evidence
- All infrastructure defined as Terraform IaC

## Identity and multi-tenancy posture

The design keeps tenant identity and user identity explicit in data models, and avoids single-user
one-way doors. This repository is the single-tenant seed of a future multi-tenant platform. Do not
build multi-tenant features now; just do not preclude them. When you add a data model, include the
tenant and user identity fields even if only one tenant exists today.

## Prose style in docs

Avoid em dashes. Use commas, colons, semicolons, or parentheses instead. Keep sentences plain and
direct.

## Diagram convention

Use Mermaid embedded in Markdown for diagrams that live inside documents. Maintain a self-contained
`architecture.html` at the repository root as the canonical architecture view (added later). Keep
the two in sync when the architecture changes.

## Working agreements for agents

- Do not create cloud resources. This repository is local scaffolding and code.
- Do not commit secrets, and do not weaken `.gitignore`, the pre-commit hooks, the CI secret
  scan, or the CI IaC security scan (Checkov). When you intentionally change infrastructure, refresh
  `infra/.checkov.baseline` rather than removing the scan or broadening its skips.
- Prefer inputs (variables, env vars, Secrets Manager, SSM) over literals every time.
- When adding a new secret or environment value, document it in `.env.example` or the relevant
  `*.tfvars.example` with a clearly fake placeholder.
