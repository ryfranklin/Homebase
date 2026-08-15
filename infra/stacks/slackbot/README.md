# slackbot stack

A private Fargate service that runs the Homebase Slack bridge
(`services/slackbot`): a slack-bolt Socket Mode app that fronts the AgentCore
agent. No load balancer, no inbound ports, no public IP. Socket Mode is an
outbound WebSocket, so the task needs only NAT egress (443 to Slack and AWS).

It mirrors the ssh-chat and mission-control stacks: an ECR repo, a KMS-encrypted
log group, ECS Exec for debugging, a least-privilege task role, and secrets
injected by the execution role. The task role can `InvokeAgentRuntime` (like the
CLI) and read + decrypt the allow-list SecureString. It runs in the shared
vault-worker private subnet (read from SSM) so it inherits the existing NAT.

## Prerequisites

- The **agent stack** (P6) is applied (this stack reads
  `/homebase/<env>/agent/runtime_arn`).
- The **vault-worker stack** is applied (this stack reads
  `/homebase/<env>/vault-worker/private_subnet_id`).

## One-time Slack app setup (manual console steps)

Extend the existing Homebase connector Slack app (do not create a second app):

1. **Socket Mode** -> enable.
2. **Basic Information -> App-Level Tokens** -> generate a token with
   `connections:write`. This is the `xapp-...` app token.
3. **OAuth & Permissions -> Bot Token Scopes** -> add: `app_mentions:read`,
   `chat:write`, `users:read.email`, `im:history`, `im:read`, `im:write`.
   Reinstall the app. The `xoxb-...` value is the bot token.
4. **Event Subscriptions** -> enable, and under **Subscribe to bot events** add:
   `app_mention`, `message.im`. (With Socket Mode on, no Request URL is needed.)

## Create the by-hand secrets and allow-list (values never in Terraform)

```
aws secretsmanager create-secret --name homebase/slackbot/bot-token \
  --secret-string 'xoxb-REPLACE'
aws secretsmanager create-secret --name homebase/slackbot/app-token \
  --secret-string 'xapp-REPLACE'

# The allow-list: a comma or newline separated list of allowed emails.
aws ssm put-parameter --type SecureString \
  --name /homebase/<env>/slackbot/allowed-emails \
  --value 'you@example.com,teammate@example.com' --region <region>
```

## Deploy

```
cp backend.hcl.example backend.hcl            # fill in bootstrap outputs (git-ignored)
cp terraform.tfvars.example terraform.tfvars  # fill in your inputs (git-ignored)

terraform -chdir=infra/stacks/slackbot init -backend-config=backend.hcl
terraform -chdir=infra/stacks/slackbot plan

# Build and push the image to the ECR repo this stack creates, then:
terraform -chdir=infra/stacks/slackbot apply   # human action; agents never apply
```

Then verify: `aws logs tail /homebase/<env>/slackbot/task --follow` should show
"Homebase Slack bridge starting (Socket Mode)", and an app mention in Slack gets
an answer. Debug with `aws ecs execute-command` against the exported
`cluster_name` / `service_name` SSM parameters.

## What this stack does NOT do

- No inbound security-group rule at all (Socket Mode is outbound-only).
- No public IP, no ALB, no Cloud Map registration (nothing calls it).
- No secret values in Terraform, state, or plans. The two Slack tokens and the
  allow-list are by-hand inputs referenced by name.
