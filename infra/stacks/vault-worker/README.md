# vault-worker stack

Runs the always-on git-vault worker (`services/vault-worker`) on Fargate: it owns
the git clone and mirrors git -> S3 -> Knowledge Base. Step one of the git
reorientation. A human applies; agents only fmt/validate/plan.

## What it creates

- A dedicated **public subnet** routed to the VPC's existing internet gateway, so
  the worker can reach **GitHub over HTTPS** (the endpoint-only Fargate subnets have
  no internet). The task gets a public IP for egress only; the security group allows
  **no inbound** (the BFF -> worker wiring in a later step adds a scoped ingress).
- An **ECS cluster + Fargate service** (desired 1, ARM64) with ECS Exec for
  debugging, an **ECR repo**, KMS-encrypted logs.
- **IAM**: the task role mirrors to the corpus bucket (S3 + corpus KMS) and
  re-grounds the KB (`bedrock:StartIngestionJob`); the execution role pulls the image
  and injects two secrets.
- A generated **BFF -> worker shared secret** (Secrets Manager), exported to SSM.

## Human setup (before apply)

1. **Create the private vault repo** on GitHub and seed `main` with a README:
   ```sh
   gh repo create <owner>/<vault-repo> --private
   # then locally: git init -b main; echo "# vault" > README.md; git add .;
   #   git commit -m init; git remote add origin <url>; git push -u origin main
   ```
2. **Create a fine-grained PAT** scoped to that repo with Contents read/write.
3. **Store the token by hand** in Secrets Manager (never in tfvars/state), using the
   `aws-secrets-manager` skill / `asm-exec` so it does not enter your shell history:
   the secret name must match `github_token_secret_name` (default
   `homebase/vault-worker/github-token`), value = the raw token.

## Apply (two steps: the service needs an image first)

```sh
cp backend.hcl.example backend.hcl            # fill from bootstrap outputs
cp terraform.tfvars.example terraform.tfvars  # fill in vpc_id, repo url, secret name
terraform -chdir=infra/stacks/vault-worker init -backend-config=backend.hcl

# 1. Create the ECR repo, then build + push the arm64 image to it.
terraform -chdir=infra/stacks/vault-worker apply -target=aws_ecr_repository.worker
REPO=$(terraform -chdir=infra/stacks/vault-worker output -raw ecr_repository_url)
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin "${REPO%/*}"
docker build --platform linux/arm64 -t "$REPO:latest" services/vault-worker
docker push "$REPO:latest"

# 2. Full apply: the service starts, clones the repo, and mirrors to S3 + the KB.
terraform -chdir=infra/stacks/vault-worker apply
```

Watch it come up: `aws logs tail /homebase/prod/vault-worker/task --follow` should
show `vault_ready` then `listening`.

## Cost note

This is the first always-on compute besides the auto-stopping workstation: a single
small Fargate task (0.5 vCPU / 1 GB) plus its public IP. Modest, but it does not
auto-stop, since git-as-source needs the mirror current.
