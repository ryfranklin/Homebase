# infra/

Terraform infrastructure as code for Homebase.

## Layout

- `modules/`: reusable Terraform modules (one concern each: networking, Cognito, Knowledge Base,
  AgentCore, CloudFront, BFF, workstation, connectors).
- `stacks/`: composed root configurations that wire modules together for a given deployment.

## Conventions

- Every environment-specific or secret value is a variable. Commit `*.tfvars.example` with fake
  placeholders; keep the real `*.tfvars` git-ignored.
- No account IDs, ARNs, domains, or secrets as literals in `.tf` files.
- Terraform is never auto-applied by an agent. Agents may run `terraform fmt`, `terraform validate`,
  and `terraform plan` only. A human runs `terraform apply`.
- The `.terraform.lock.hcl` file is committed. State files (`*.tfstate`) are never committed.
