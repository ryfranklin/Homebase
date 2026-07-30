# infra/stacks/

Composed root Terraform configurations that assemble modules from `../modules/` into a deployable
whole. Each stack reads its inputs from a git-ignored `*.tfvars` (see `terraform.tfvars.example` at
the `infra/` root for the shape).

Agents may run `fmt`, `validate`, and `plan` here. A human runs `apply`.
