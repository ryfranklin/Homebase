# mission-control stack

Deploys Mission Control (the execution engine) as a VPC-internal Fargate service so
the Homebase BFF can hand it flight-plan units as runs. Mission Control is a separate
repo (`../Mission-Control`); this stack builds and runs its container in the Homebase
AWS account.

## What it creates

- **ECS Fargate service** (arm64), one task, in the shared vault-worker private
  subnet (NAT egress + BFF reachability already there). Registered in Cloud Map as
  `mission-control.<namespace>` so the BFF resolves `http://mission-control.homebase.internal:8000`.
- **RDS PostgreSQL** (`db.t4g.micro`, single-AZ, encrypted) for the durable run
  ledger + LangGraph checkpointer, in two new RDS-only subnets (RDS needs a two-AZ
  subnet group; these carry no NAT route and talk intra-VPC only).
- **Secrets:** a generated BFF -> Mission Control **bearer token** and the **Postgres
  URL** (holds the generated DB password). The GitHub token is by-hand (below).
- **IAM:** task role gets `bedrock:InvokeModel` on the worker's inference profile;
  the execution role injects the three secrets. ECS Exec enabled for debugging.
- **KMS** key for logs, exec, secrets, and RDS storage; **ECR** repo; **SSM exports**
  (`/homebase/prod/mission-control/{url,api_token_secret_arn,cluster_name,service_name}`).

The worker reaches Claude via **Bedrock** (`CLAUDE_CODE_USE_BEDROCK=1` + the task
role's creds), so no Anthropic API key. Git auth to clone/push target repos comes
from the by-hand GitHub token, wired by the container entrypoint (never on disk).

## Prerequisites

1. **vault-worker stack applied** (this stack reads its private subnet + client SG +
   Cloud Map namespace from SSM).
2. **The by-hand GitHub token secret** exists (fine-grained, Contents R/W on the
   target repos):
   ```sh
   read -rs GH_TOKEN
   aws secretsmanager create-secret --name homebase/mission-control/github-token \
     --secret-string "$GH_TOKEN" --region <region>; unset GH_TOKEN
   ```
3. **Bedrock access** to the worker model (`worker_model` tfvar) in the region.
4. `terraform.tfvars` + `backend.hcl` filled in (copy the `.example` files). Pick two
   free /24 CIDRs for `rds_subnet_cidrs` (check existing subnets first).

## Deploy

```sh
cd infra/stacks/mission-control
terraform init -backend-config=backend.hcl

# 1. Create the ECR repo first (the service can't start without an image).
terraform apply -target=aws_ecr_repository.this

# 2. Build + push the Mission Control image (from the Mission-Control repo, arm64).
REPO=$(terraform output -raw ecr_repository_url)
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin "${REPO%/*}"
docker build --platform linux/arm64 -t "${REPO}:latest" ../../../../Mission-Control   # adjust path to the MC repo
docker push "${REPO}:latest"

# 3. Full apply (RDS creation takes several minutes).
terraform apply
```

## Wire the BFF (final step)

The api stack reads the two SSM exports and sets `HOMEBASE_MISSION_CONTROL_URL` +
`HOMEBASE_MISSION_CONTROL_TOKEN_ARN` on the BFF, plus `secretsmanager:GetSecretValue`
on the token secret. Re-apply the api stack after this stack, then the BFF's
`/api/missions/*` routes go live. (The BFF is already in the vault-worker client SG,
which this stack's task SG admits on 8000, so no BFF SG change is needed.)

## Verify

```sh
aws ecs describe-services --cluster homebase-prod-mission-control \
  --services homebase-prod-mission-control --query 'services[0].{running:runningCount,status:status}'
# smoke: exec in and curl the health endpoint (no auth on /health)
```

## Cost

An always-on Fargate task + an RDS instance: real recurring spend (~$30-60/mo),
unlike the mostly-serverless rest of Homebase. Scale to zero by setting the service
desired count to 0 when idle.

## Notes

- Demo-grade single-box posture (Mission Control's own v1). RDS Multi-AZ + a second
  worker DB are the graduation path.
- `deletion_protection` is on and a final snapshot is taken; to tear down, disable
  protection first.
