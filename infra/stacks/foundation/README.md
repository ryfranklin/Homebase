# stacks/foundation

The foundational, always-on infrastructure that later stacks build on. It stores its state remotely
in the S3 bucket and DynamoDB lock table created by the `bootstrap` stack.

## What it creates

- A customer managed KMS key (via `modules/kms`, rotation enabled) for storage and logs encryption.
- A private-only VPC (via `modules/vpc`) with private subnets and VPC endpoints for S3, SSM, ECR,
  CloudWatch Logs, and Bedrock. No public ingress.
- A monthly AWS Budgets cost budget that alerts an SNS topic at configurable thresholds, with email
  subscribers. This is the cost guardrail.

## Remote state backend

The backend is a partial S3 configuration (`backend.tf` has an empty `backend "s3" {}` block). The
concrete values come from a git-ignored `backend.hcl`; see `backend.hcl.example` for the shape. No
bucket name, region, or key ARN is committed.

## Initialize (human runs, after bootstrap has been applied)

```bash
cp backend.hcl.example backend.hcl              # then edit with bootstrap outputs
cp terraform.tfvars.example terraform.tfvars    # then edit with real values
terraform -chdir=infra/stacks/foundation init -backend-config=backend.hcl
```

Agents may run `fmt`, `validate`, and `plan` only. A human runs `apply`.
