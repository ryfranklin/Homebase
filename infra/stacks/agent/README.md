# stacks/agent

The agent plane: an AgentCore Runtime that hosts the Homebase agent (services/agent), plus AgentCore
Memory and observability wiring. State lives remotely in the bootstrap bucket.

## What it creates

- An ECR repository for the agent container image (KMS-encrypted, scan on push).
- A customer managed KMS key for memory and agent logs.
- AgentCore Memory (short-term events; an optional long-term extraction strategy) with a scoped
  memory execution role.
- A least-privilege AgentCore Runtime execution role: Bedrock model invoke, KB retrieve, rerank, and
  AgentCore Memory only. No S3 access, no broad `bedrock:*`. The only `resource = "*"` entries are the
  AWS-required ones (X-Ray, ECR auth token, namespace-scoped metric publishing).
- The AgentCore Runtime, with OTEL observability env vars and the config it needs (KB id, model id,
  rerank ARN, memory id) passed as environment variables. Model id is a variable.
- A CloudWatch Logs resource policy so X-Ray can deliver trace spans (Transaction Search prerequisite).
- SSM `String` exports (runtime ARN, memory id, ECR repo URL) for the BFF (P7).

## Streaming

The runtime is invoked with `InvokeAgentRuntime`, which supports response streaming end to end (SSE).
That means the P7 BFF can use Lambda response streaming to proxy the agent stream to the SPA, without
needing a WebSocket API for the streaming path.

## Two by-hand / ordering steps (documented, not automated)

1. Build and push the agent image before the runtime can reference it:
   ```bash
   terraform -chdir=infra/stacks/agent apply -target=aws_ecr_repository.agent   # create the repo
   # docker build services/agent, tag as <repo-url>:<agent_image_tag>, docker push
   terraform -chdir=infra/stacks/agent apply                                    # then the runtime
   ```
2. Enable CloudWatch Transaction Search once per account (no first-class Terraform resource):
   ```bash
   aws xray update-trace-segment-destination --destination CloudWatchLogs
   ```

## Initialize and validate (human runs apply, agents do not)

```bash
cp backend.hcl.example backend.hcl             # edit with bootstrap outputs
cp terraform.tfvars.example terraform.tfvars   # edit with real values
terraform -chdir=infra/stacks/agent init -backend-config=backend.hcl
terraform -chdir=infra/stacks/agent plan
```

Agents may run `fmt`, `validate`, and `plan` only. A human runs `apply`.
