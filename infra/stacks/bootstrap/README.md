# stacks/bootstrap

This is the ONLY stack that uses LOCAL Terraform state, and it is applied exactly once.

## Why local state here

Every other stack stores its state remotely in an S3 bucket with a DynamoDB lock table. This stack
is what creates that bucket and table. It cannot store its own state in a backend that does not
exist yet, so it uses local state to break the chicken-and-egg problem. There is no `backend "s3"`
block in `versions.tf` for exactly this reason.

The resulting `terraform.tfstate` (and any backup) is git-ignored by the repository root
`.gitignore` (`*.tfstate`, `*.tfstate.*`). It contains resource metadata and must never be
committed to this public repository.

## What it creates

- An S3 state bucket: versioned, KMS-encrypted, with block-public-access fully on and a policy that
  denies non-TLS access. The bucket name comes from the `state_bucket_name` variable, never a
  literal.
- A DynamoDB lock table (name from the `lock_table_name` variable), encrypted with the same key.
- A KMS key (via `modules/kms`) with rotation enabled, used to encrypt both.

## How other stacks consume it

The bootstrap outputs (`state_bucket_name`, `lock_table_name`, `state_kms_key_arn`, `region`) become
the S3 backend configuration for every other stack. See `stacks/foundation/backend.hcl.example` for
the shape. You copy those output values into a git-ignored `backend.hcl` and run
`terraform init -backend-config=backend.hcl`.

## Apply (human runs this once)

Agents never apply. A human runs:

```bash
cp terraform.tfvars.example terraform.tfvars   # then edit with real values
terraform -chdir=infra/stacks/bootstrap init
terraform -chdir=infra/stacks/bootstrap apply
```
