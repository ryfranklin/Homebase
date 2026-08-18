# eval stack

Deploys the Homebase eval harness as an on-demand benchmark runner. It runs one
task suite across many Bedrock models via the Converse API and scores each on
quality (LLM judge), latency, cost, and task success, then stores the results.

The scoring engine lives in the top-level `eval/` package (`homebase_eval`); this
stack packages its batch runner as a container and gives it somewhere to run and
somewhere to write.

## What it creates

- **ECR repository** (`homebase-<env>-eval`) for the batch runner image.
- **ECS cluster** + **Fargate task definition** (arm64), run-to-completion. No
  long-lived service and no schedule: runs are launched on demand.
- **DynamoDB table** (`homebase-<env>-eval`, on-demand billing) as the run
  ledger: one run header item plus one item per (model, case) score. Keyed by
  tenant and user (the multi-tenant seed).
- **S3 bucket** for raw prompt/response artifacts, CMK-encrypted, private, with a
  lifecycle expiry (`artifact_retention_days`).
- **SSM pricing parameter** (`/homebase/<env>/eval/pricing`) the runner reads at
  run time, seeded from the committed placeholder table. Edit it in place to fix
  prices without a redeploy.
- **CloudWatch log group** + **dashboard** (quality, latency, cost per model,
  discovered from the EMF metrics the runner emits).
- **IAM** scoped to exactly the models under test: `bedrock:InvokeModel` on the
  derived inference-profile / foundation-model ARNs, DynamoDB write on the table,
  S3 write on the bucket, SSM read on the pricing parameter, KMS use for the CMK.
- **SSM outputs** (cluster, task definition, subnet, SG, table, bucket, ECR) for
  the deploy and run scripts.

## Prerequisites

- The **vault-worker** stack applied: this stack reuses its private subnet
  (`/homebase/<env>/vault-worker/private_subnet_id`) for NAT egress to Bedrock.
- The bootstrap state bucket + lock table (backend), like every stack.
- The benchmark models and judge must be **enabled in Bedrock** for the account.
  Verified 2026-08-17: Sonnet 4.6 and Haiku 4.5 are enabled; Opus 4.8/5 and
  Sonnet 5 return AccessDenied; Qwen and GLM variants work.

## Deploy

```bash
cd infra/stacks/eval
cp backend.hcl.example backend.hcl        # fill in bootstrap outputs (unique key!)
cp terraform.tfvars.example terraform.tfvars
terraform init -backend-config=backend.hcl
terraform plan
terraform apply                            # creates the ECR repo (empty) + everything else

# Build, verify, push the image, and re-apply with the new tag:
../../../scripts/deploy-eval.sh
```

## Run a benchmark (on demand)

```bash
./scripts/run-eval.sh
# override the model set or judge for one run:
EVAL_MODELS="us.anthropic.claude-sonnet-4-6,zai.glm-5" EVAL_JUDGE="us.anthropic.claude-sonnet-4-6" ./scripts/run-eval.sh
```

Watch the run in the `homebase-<env>-eval` log group. Results land in DynamoDB
(query `pk = RUN#<run_id>` for scores, `pk = TENANT#<tenant>` for the run list)
and raw artifacts in the S3 bucket under `runs/<run_id>/`. The dashboard shows
quality, latency, and cost per model over time.

## Cost

Effectively zero at rest: DynamoDB on-demand, S3 pay-per-use with expiry, no
standing compute and no schedule. Cost is the Bedrock tokens a run spends plus a
few cents of storage. The KMS key and CloudWatch are the only small fixed items.

## Notes

- Bedrock IAM is scoped to the derived ARNs. Providers whose on-demand ARN shape
  differs from the derived one can be allow-listed via `additional_model_arns`
  without widening to `*`.
- The pricing parameter uses `ignore_changes = [value]` so an apply never reverts
  prices you edited in the console.
