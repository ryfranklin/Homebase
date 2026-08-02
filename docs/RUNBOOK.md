# Homebase deploy-and-verify runbook

The end-to-end checklist to stand Homebase up for real: apply order, by-hand steps, live
verification, and the pre-public secret sweep. All values here are placeholders.

Ground rules (from CLAUDE.md):

- A human runs `terraform apply`, one plan at a time, reviewing each plan. Agents run only
  `fmt` / `validate` / `plan`.
- Every environment-specific or secret value is an input (Terraform variable, env var, Secrets
  Manager, or SSM Parameter Store), never a committed literal.
- For each stack: `cp backend.hcl.example backend.hcl` and `cp terraform.tfvars.example
  terraform.tfvars`, fill in real values (git-ignored), then
  `terraform -chdir=infra/stacks/<stack> init -backend-config=backend.hcl` and `... plan` and
  `... apply`.

---

## 0. The bedrock-agentcore VPC endpoint (now a foundation default)

The foundation VPC (P2) is private-only with no NAT, so private-subnet compute reaches AWS through
interface endpoints. Four things call the AgentCore data plane and need a `bedrock-agentcore`
interface endpoint (service name `com.amazonaws.<region>.bedrock-agentcore`, which covers all data
plane primitives including Runtime `InvokeAgentRuntime`):

- the agent runtime and connectors Gateway, and
- the chat CLI (Fargate, private subnet) and the workstation (EC2, private subnet) that invoke
  `InvokeAgentRuntime`.

This endpoint is now baked into the VPC module's `interface_endpoints` default (alongside `ssm`,
`ssmmessages`, `ec2messages`, `ecr.api`, `ecr.dkr`, `logs`, `bedrock-runtime`, `bedrock-agent-runtime`),
so **no manual pre-apply step is required**: applying foundation creates it automatically. If you
started foundation on an older module revision that lacked it, a plain `terraform apply` of foundation
adds the endpoint. Omitting it is the single most likely cause of a confusing apply failure, because a
private-subnet `InvokeAgentRuntime` call will hang/time out with no obvious cause.

> The BFF Lambda (api) invokes the runtime too, but it is not VPC-attached, so it uses public AWS
> endpoints and does not need the VPC endpoint.

---

## 1. Apply order across the twelve stacks

Apply in this order. Each entry states WHY it depends on what came before, and the cross-stack
outputs it consumes (via SSM parameters, or Terraform variables sourced from a prior stack's outputs).

| # | Stack | Depends on / why | Consumes |
| --- | --- | --- | --- |
| 0 | **bootstrap** | Already applied. Creates the S3 state bucket + DynamoDB lock table that every other stack uses as its backend. | (local state) |
| 1 | **foundation** | First: the VPC, KMS, and budget SNS everything else builds on. Creates the `bedrock-agentcore` endpoint automatically (module default, section 0). | — |
| 2 | **identity** | Cognito pool that api and connectors authorize against. Independent of foundation resources but sequenced early. | Google OAuth client secret (Secrets Manager, by hand) |
| 3 | **storage** | The corpus bucket the knowledge base ingests from. | — |
| 4 | **retrieval** | The Bedrock KB on S3 Vectors reads the corpus bucket. | SSM: `storage/corpus_bucket_name`, `storage/corpus_kms_key_arn` |
| 5 | **agent** | The AgentCore runtime needs the KB id and rerank model id to configure retrieval. Needs the bedrock-agentcore endpoint (section 0). | SSM: `retrieval/knowledge_base_id`, `retrieval/rerank_model_id` |
| 6 | **api** | The BFF invokes the agent runtime and validates the Cognito JWT. | SSM: `agent/runtime_arn`, `identity/issuer_url`, `identity/app_client_id` |
| 7 | **web** | CloudFront fronts the BFF Function URL and injects the origin shared-secret header. | SSM: `api/bff_function_url`, `api/origin_secret_arn`; Secrets Manager: origin secret value |
| 8 | **ssh-chat** | The Fargate CLI invokes the agent runtime from a private subnet. Needs the bedrock-agentcore endpoint. | SSM: `agent/runtime_arn`; vars: `vpc_id`, `private_subnet_ids` (foundation outputs) |
| 9 | **workstation** | The dev box invokes the agent and needs outbound egress. Adds the VPC's internet gateway + NAT. Needs the bedrock-agentcore endpoint for agent calls. | var: `vpc_id` (foundation output); Secrets Manager: shell secret; SSM: dotfiles URL (created from tfvars) |
| 10 | **connectors** | AgentCore Gateway authorizes with the same Cognito JWT; needs the bedrock-agentcore endpoint for in-VPC targets. | SSM: `identity/issuer_url`, `identity/app_client_id`; Secrets Manager / tfvars: per-connector client secrets |
| 11 | **monitoring** | Wires alarms to the P2 budget SNS and dashboards to resources created by earlier stacks. Apply last. | SSM: `foundation/budget_sns_topic_arn`, `foundation/kms_key_arn`; vars: `workstation_instance_id`, `cloudfront_distribution_id` |

Dependency summary: foundation before everything; retrieval after storage; agent after retrieval;
api after agent and identity; web after api; the agent-invoking stacks (agent, ssh-chat, workstation,
connectors) after the `bedrock-agentcore` endpoint exists; monitoring last.

---

## 2. By-hand steps, in the order they are needed

Each step names where the secret lands. Never commit a real value.

### 2a. Google OAuth client — before applying identity (P3)

1. In the Google Cloud Console, create an OAuth 2.0 Client ID (type: Web application).
2. Decide your `hosted_ui_domain_prefix`, then set the authorized redirect URI to:
   `https://<YOUR_HOSTED_UI_PREFIX>.auth.<YOUR_AWS_REGION>.amazoncognito.com/oauth2/idpresponse`
3. **Client secret → AWS Secrets Manager** (for example `homebase/google-oauth-client-secret`).
   The client id goes into the git-ignored `infra/stacks/identity/terraform.tfvars` as
   `google_client_id`.

### 2b. ACM certificate + DNS — before applying web (P8)

1. Request an ACM certificate in **us-east-1** (CloudFront requires us-east-1) for
   `<YOUR_APP_DOMAIN>`, and validate it via DNS.
2. Put the certificate ARN into `infra/stacks/web/terraform.tfvars` (`acm_certificate_arn`) and the
   domain into `domain_names`. After apply, point DNS (a CNAME/ALIAS) at the CloudFront distribution
   domain. (Skip this to use the default `*.cloudfront.net` domain and certificate.)

### 2c. Slack app + connector OAuth apps — before applying connectors (P11)

1. Register a NEW dedicated **Homebase** Slack app in your workspace (its own scopes and credentials;
   do not reuse any other app's tokens). Request read scopes by default; add a write scope only for a
   gated write tool.
2. Register each other connector's OAuth app (Google connectors, QuickBooks, Atlassian) with
   read-first scopes.
3. **Each client secret → the git-ignored connectors tfvars**, and AgentCore Identity stores it. The
   client ids go into the same git-ignored tfvars. User tokens are held and refreshed by AgentCore
   Identity. See [connectors.md](./connectors.md).

### 2d. Workstation dotfiles + shell secret — before applying workstation (P10)

1. **Your `~/.zshrc.local` shell secret → AWS Secrets Manager** (for example
   `homebase/workstation/shell-secrets`). It is pulled at session start by the instance role.
2. Set `dotfiles_repo_url` in `infra/stacks/workstation/terraform.tfvars`. The stack publishes it to
   SSM (`workstation/dotfiles_repo_url`); the bootstrap reads it at login. Nothing is baked into the
   AMI or committed.

---

## 3. Live retrieval eval — the ADR-002 decision gate

After storage + retrieval + agent are applied and the corpus is ingested, decide on evidence whether
S3 Vectors semantic + rerank clears your bar, or whether to fall back to OpenSearch Serverless.

```bash
cd eval && pip install -e '.[live]'
export HOMEBASE_KB_ID=<YOUR_KNOWLEDGE_BASE_ID>          # SSM: /homebase/<env>/retrieval/knowledge_base_id
export HOMEBASE_RERANK_MODEL_ARN=<YOUR_RERANK_MODEL_ARN>
export AWS_REGION=<YOUR_AWS_REGION>
# Point at your OWN private, uncommitted question -> expected-source set, not the synthetic fixtures.
PYTHONPATH=src python -m homebase_eval.cli --mode live --k 5 --cases <YOUR_PRIVATE_CASES_JSON>
```

Read the scorecard's `base` (semantic-only) vs `rerank` columns.

**The condition that flips you to OpenSearch Serverless (ADR-002):** if, on your real corpus,
reranked `hit_rate@5` stays below your acceptance target (for example `< 0.85`), OR exact-term /
keyword-style queries systematically miss even with rerank (the semantic-only weakness that hybrid
would fix), then trigger the fallback: set `vector_store_type = "OPENSEARCH_SERVERLESS"` in the
retrieval stack (the marked seam), rebuild the index, and re-run this eval to confirm hybrid clears
the bar. If reranked quality clears the target, stay on S3 Vectors.

This is a real decision gate with a concrete threshold, not a vibe check. Record the numbers and the
decision in ADR-002.

---

## 4. Validate both front doors from a phone

### 4a. GUI door (Cognito + Google, streamed cited answer)

1. Open `https://<YOUR_APP_DOMAIN>` on the phone.
2. Tap "Continue with Google" (or "Sign in"); complete the Cognito hosted-UI + Google flow.
3. Ask a question whose answer is in your corpus. Confirm: tokens **stream in** (not a single delayed
   block), and the answer shows **source citations**.
4. Ask something not in the corpus; confirm it says it has no relevant source rather than inventing one.
5. Ask for a write (for example "email X"); confirm it returns a **confirmation prompt** and does not
   send until you confirm.
6. Confirm the layout is comfortable on the narrow viewport (mobile-first).

### 4b. SSH door — thin chat CLI (SSM / ECS Exec)

1. From a mobile shell with your SSO profile (or a laptop), find the task and exec in:
   ```bash
   CLUSTER=$(aws ssm get-parameter --name /homebase/<env>/cli/cluster_name --query Parameter.Value --output text)
   SERVICE=$(aws ssm get-parameter --name /homebase/<env>/cli/service_name --query Parameter.Value --output text)
   TASK=$(aws ecs list-tasks --cluster "$CLUSTER" --service-name "$SERVICE" --query 'taskArns[0]' --output text)
   aws ecs execute-command --cluster "$CLUSTER" --task "$TASK" --container cli --interactive --command "/bin/sh"
   ```
2. Inside: `homebase-cli --prompt "..."`. Confirm the same cited answer as the GUI (behavior parity).
   See [ssh-access.md](./ssh-access.md).

### 4c. SSH door — workstation (start, verify parity, stop)

1. Start it: `aws ec2 start-instances --instance-ids <YOUR_WORKSTATION_INSTANCE_ID>`.
2. Connect: `aws ssm start-session --target <YOUR_WORKSTATION_INSTANCE_ID>`.
3. Confirm dotfiles parity: `~/.zshrc.local` exists (pulled from Secrets Manager), `/workspace` is
   mounted (the persistent home volume), and the toolchain (git/docker/node/python/aws) is present.
4. Stop it: `aws ec2 stop-instances --instance-ids <YOUR_WORKSTATION_INSTANCE_ID>`. Confirm scheduled
   auto-stop also stops the NAT instance so egress cost drops to zero. See [workstation.md](./workstation.md).

---

## 5. Post-deploy smoke test: rerank + S3 Vectors together

This is the one ADR-002 capability that was not verifiable from a single verbatim AWS statement:
Bedrock Rerank applied at query time against a KB backed by S3 Vectors. Prove it in your region:

```bash
aws bedrock-agent-runtime retrieve \
  --knowledge-base-id <YOUR_KNOWLEDGE_BASE_ID> \
  --retrieval-query '{"text":"a known exact-term query from your corpus"}' \
  --retrieval-configuration '{
    "vectorSearchConfiguration": {
      "numberOfResults": 20,
      "overrideSearchType": "SEMANTIC",
      "rerankingConfiguration": {
        "type": "BEDROCK_RERANKING_MODEL",
        "bedrockRerankingConfiguration": {
          "modelConfiguration": {"modelArn": "<YOUR_RERANK_MODEL_ARN>"},
          "numberOfRerankedResults": 5
        }
      }
    }
  }' \
  --region <YOUR_AWS_REGION>
```

Expected: a 200 with reranked `retrievalResults`. If the call errors that reranking is unsupported on
this path in your region, that is the smoke-test failure: confirm the rerank model id/region, and if
unsupported, treat it as input to the ADR-002 fallback decision.

---

## 6. Final pre-public secret sweep

The history of a public repo is forever. Sweep every commit, not just the working tree, before
flipping the repo public.

```bash
# Full history, not just the working tree.
gitleaks detect --source . --redact --log-opts="--all"

# Manual sweep for account ids, personal domains, and identifiers across tracked files.
git grep -nIE '[0-9]{12}|amazoncognito\.com|apps\.googleusercontent|xoxb-|AKIA[0-9A-Z]{16}' -- \
  ':!*.terraform.lock.hcl' || echo "clean"
git grep -nIE '<YOUR_PERSONAL_DOMAIN>|<YOUR_ACCOUNT_ALIAS>' || echo "no personal identifiers"
```

Both must come back clean. Only then flip the repository to public. After going public, treat any
secret ever committed as compromised: rotate first (Secrets Manager, the provider console, Cognito),
then rewrite history.

---

## Done

Twelve stacks that validate, application code with tests green, the safety rails enforced end to end,
nothing applied. From here: add the `bedrock-agentcore` endpoint to foundation, do the by-hand OAuth
and cert steps, then apply the stacks in order with your credentials, one plan at a time.
