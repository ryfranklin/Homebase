# Homebase

Homebase is a personal AI pipeline: an authenticated web GUI plus an SSH plane over a private
knowledge base, running on AWS and Anthropic-native. It is the single-tenant seed of a future
multi-tenant platform.

This repository is PUBLIC. Every committed file is world-readable. No account IDs, ARNs, secrets,
real domains, or personal identifiers live in the repo. Every environment-specific value is an
input (a Terraform variable, a runtime environment variable, an AWS Secrets Manager secret, or an
SSM Parameter Store SecureString), never a literal in code. See [CLAUDE.md](./CLAUDE.md) for the
full conventions.

## Architecture

- Agent runtime on Amazon Bedrock AgentCore, running a tool-use loop over knowledge-base search and
  the live connectors, streaming its answer token by token
- Retrieval via Bedrock Knowledge Base with S3 Vectors, using semantic retrieval plus Bedrock Rerank
  (S3 Vectors is semantic-only; hybrid is the gated OpenSearch Serverless seam, ADR-002)
- Authentication via Amazon Cognito with Google federation
- Web GUI as a React SPA served from CloudFront, rendering the streamed response live
- Streaming backend for frontend (BFF) as a Lambda Function URL with response streaming (SSE), fronted
  by CloudFront; not behind API Gateway
- A thin chat CLI running as a Fargate container
- A separate EC2 workstation reached over SSM (no public SSH)
- Six live connectors (Gmail, Calendar, Drive, Slack, Jira, Confluence): read-first and write-gated,
  each with per-user OAuth via AgentCore Identity (an AgentCore Gateway also exposes them as MCP tools);
  the user links an account once through a self-service consent flow in the GUI
- A git-authoritative vault: a Fargate vault worker owns the clone and commits every write, so notes
  and flight plans are versioned and attributed from git; the S3 corpus is the derived KB mirror
- A Flight Planner where the agent runs an AI-DLC INCEPTION interview to produce reviewed flight plans,
  handed to Mission Control (a durable, cost-metered coding-agent orchestrator on Fargate + RDS, its own
  repo) for execution, with live per-step telemetry and a go/no-go gate surfaced in the GUI Mission deck
- Confluence design pages as grounded plan sources, and Jira materialization of a cleared plan (an epic
  plus a story per unit) through the write-gated connector: design in, tickets out
- All infrastructure defined as Terraform IaC

For the full picture (the two access planes, the retrieval flow, the layered security perimeter, the
connector strategy, and the planning-to-execution loop), open the self-contained
**[architecture.html](./architecture.html)** at the repository root (inline CSS and vanilla JS, no build
step, no network).

```mermaid
flowchart TB
    subgraph doors["Access planes"]
        SPA["Web GUI (React SPA)"]
        CLI["Thin chat CLI (Fargate)"]
        WS["Workstation (EC2)"]
    end

    subgraph guiperim["GUI door: layered perimeter"]
        direction TB
        CF["CloudFront + WAF"] --> SEC["X-Origin-Secret header"] --> JWT["In-function Cognito JWT<br/>(per-user + per-tenant)"] --> BFF["Streaming Lambda BFF<br/>(Function URL, SSE)"]
    end

    subgraph sshperim["SSH door: IAM / SSM boundary"]
        direction TB
        SSM["SSM only: no key pair,<br/>no inbound, no public IP"] --> ROLES["Least-privilege roles<br/>(assume-role for broad ops)"]
    end

    CORE["AgentCore Runtime<br/>Claude on Bedrock · tool-use loop · streaming · Memory"]

    subgraph retrieval["Retrieval (semantic + rerank)"]
        direction TB
        S3["Markdown corpus (private S3)"] --> KB["Bedrock KB · Amazon S3 Vectors<br/>(semantic-only)"] --> RR["over-retrieve → Bedrock Rerank → filter"]
        OSS["OpenSearch Serverless<br/>(gated HYBRID seam, ADR-002)"] -. fallback .-> KB
    end

    subgraph conn["Connectors (live, read-first, write-gated, never indexed)"]
        GW["AgentCore Identity (per-user OAuth)<br/>+ Gateway (MCP)"] --> SIX["Gmail · Calendar · Drive · Slack · Jira · Confluence"]
    end

    subgraph exec["Planning &amp; execution"]
        direction TB
        FP["Flight Planner<br/>(AI-DLC interview)"] --> PLAN["Flight plan<br/>(git vault, reviewed)"] --> MC["Mission Control<br/>Fargate + RDS · worktree · Bedrock · gate"]
        MC --> JIRA["Jira epic + stories<br/>(materialize, write-gated)"]
    end

    SPA --> CF
    CLI --> SSM
    WS --> SSM
    BFF --> CORE
    ROLES --> CORE
    CORE --> retrieval
    CORE --> conn
    CORE --> FP
    BFF --> MC
```

Retrieval on Amazon S3 Vectors is **semantic plus Bedrock Rerank, not hybrid**. Hybrid (dense plus
keyword) is not available on S3 Vectors; OpenSearch Serverless is the gated hybrid seam (ADR-002),
chosen on evidence from the eval harness, not by default.

## Monorepo layout

```text
infra/          Terraform IaC (modules/ and stacks/)
services/       Backend services
  agent/        AgentCore agent runtime
  bff/          Streaming Lambda BFF (Function URL, SSE)
  ingestion/    Knowledge base ingestion pipeline
  connectors/   Six live connectors (read-first shim Lambdas + catalog)
  vault-worker/ Fargate service that owns the git vault clone (writes commit to git)
web/            React SPA (Vault · Chat · Plan · Mission surfaces)
cli/            Thin chat CLI container
workstation/    EC2 workstation bootstrap
eval/           Retrieval and agent evaluation harness
docs/           Project documentation
```

Mission Control (the execution engine) is a separate repository, deployed into this account by the
`mission-control` Terraform stack and reached over the private VPC. The contract between them is
documented in `docs/mission-control-seam.md`.

## Setup prerequisites

- AWS credentials via SSO. Sign in with `aws login` (browser based, no long-lived access keys).
  Set your region with `export AWS_REGION=<YOUR_AWS_REGION>`.
- Terraform (see `infra/` for the pinned version once foundation lands).
- Node.js (for `web/` and `cli/`).
- Python (for `services/`, `eval/`, and tooling).

Copy `.env.example` to `.env` (git-ignored) and fill in local values. Copy
`infra/terraform.tfvars.example` to `infra/terraform.tfvars` (git-ignored) and fill in your inputs.

## Pre-commit hooks

This repository uses [pre-commit](https://pre-commit.com/) to run secret scanning (gitleaks),
`terraform fmt`, and whitespace hygiene before every commit. Install it once:

```bash
# Install the pre-commit tool (choose one)
pipx install pre-commit        # or: pip install pre-commit, or: brew install pre-commit

# Register the git hooks in this repo
pre-commit install

# Optional: run against the whole tree
pre-commit run --all-files
```

After `pre-commit install`, the hooks run automatically on each `git commit`.

## Security

See [SECURITY.md](./SECURITY.md) for how secrets are handled and how to report an issue.
Infrastructure is never auto-applied by an agent: agents may run `terraform fmt`, `validate`, and
`plan` only; a human runs `apply`.
