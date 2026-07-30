# stacks/storage

The source corpus store for Homebase: the private S3 bucket that holds the Markdown knowledge base
the ingestion tool mirrors into. It stores its own Terraform state remotely in the bootstrap bucket.

## What it creates

- A private S3 bucket for the source corpus: versioned, KMS-encrypted (via `modules/kms`, rotation
  enabled), block-public-access fully on, a policy that denies non-TLS access, and a lifecycle
  policy that expires noncurrent versions and aborts stale multipart uploads.
- The bucket name is derived from inputs (`<project_name>-<environment>-corpus-<bucket_suffix>`),
  never a literal.
- SSM `String` parameters for the corpus bucket name and KMS key ARN, so the ingestion tool and the
  P5 Knowledge Base can discover them. Nothing secret is stored.

## Initialize and validate (human runs apply, agents do not)

```bash
cp backend.hcl.example backend.hcl             # edit with bootstrap outputs
cp terraform.tfvars.example terraform.tfvars   # edit with real values
terraform -chdir=infra/stacks/storage init -backend-config=backend.hcl
terraform -chdir=infra/stacks/storage plan
```

Agents may run `fmt`, `validate`, and `plan` only. A human runs `apply`.
