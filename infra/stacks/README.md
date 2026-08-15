# infra/stacks/

Composed root Terraform configurations that assemble modules from `../modules/` into a deployable
whole. Each stack reads its inputs from a git-ignored `*.tfvars` (see `terraform.tfvars.example` at
the `infra/` root for the shape).

The apply order and per-stack dependencies are in `docs/RUNBOOK.md`. One optional door is `slackbot`:
a private Fargate Socket Mode app that invokes the agent from Slack (no inbound, NAT egress only). It
is an independent add-on, applied any time after the `agent` and `vault-worker` stacks; it needs two
by-hand Slack secrets (a bot `xoxb` token and an app-level `xapp` token) and a by-hand SSM SecureString
allow-list. Redeploy its image with `scripts/deploy-slackbot.sh`.

Agents may run `fmt`, `validate`, and `plan` here. A human runs `apply`.
