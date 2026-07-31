# stacks/monitoring

Cost guardrails and per-plane observability. State lives remotely in the bootstrap bucket.

## Cost alarms wired to the P2 budget SNS

The alarms notify the SAME SNS topic the P2 budget uses (read from SSM at
`/homebase/<env>/foundation/budget_sns_topic_arn`), not a new orphan topic:

- Bedrock invocations/hour and output tokens/hour (an agent spend proxy). Dollar budgeting stays in
  AWS Budgets (P2) and Cost Explorer; these are fast in-region CloudWatch early-warnings on the same
  channel.
- A workstation running-too-long alert: a scheduled Lambda reads the instance launch time and
  publishes to the P2 topic past a threshold (there is no CloudWatch uptime metric). Disabled unless
  `workstation_instance_id` is set.

## Per-plane dashboards

Three CloudWatch dashboards so you can tell which door is unhappy:

- `agent-retrieval`: Bedrock invocations, latency, and token throughput.
- `front-doors`: the GUI plane (BFF Lambda duration/errors, optional CloudFront requests/5xx) and the
  chat CLI plane (ECS CPU/memory) distinctly.
- `workstation`: EC2 CPU and network (only when the workstation id is set).

## Initialize and validate (human runs apply, agents do not)

```bash
cp backend.hcl.example backend.hcl             # edit with bootstrap outputs
cp terraform.tfvars.example terraform.tfvars   # edit with real values
terraform -chdir=infra/stacks/monitoring init -backend-config=backend.hcl
terraform -chdir=infra/stacks/monitoring plan
```

Agents may run `fmt`, `validate`, and `plan` only. A human runs `apply`.
