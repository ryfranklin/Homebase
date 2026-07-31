# stacks/ssh-chat

The thin chat CLI plane: an ECS Fargate service running the `cli/` image in a private subnet,
reachable only via ECS Exec over SSM. State lives remotely in the bootstrap bucket.

## What it creates

- An ECR repo for the CLI image (KMS-encrypted, scan on push) and a KMS key for logs and the ECS
  Exec data channel.
- An ECS cluster with ECS Exec configured: the exec data channel is KMS-encrypted and logged to a
  dedicated CloudWatch log group (auditable shell sessions).
- A least-privilege task role: `bedrock-agentcore:InvokeAgentRuntime` plus the SSM Messages channel
  actions ECS Exec needs. No S3, no direct KB, no Secrets Manager. Retrieval happens inside the agent.
- A Fargate task and service: no public IP, no load balancer, and a security group with NO ingress
  (egress 443 only, to reach the VPC endpoints). `enable_execute_command = true` is the only way in.
- The identity the task presents to the agent (`cli_user_id`, `cli_tenant_id`) is supplied as config,
  so tenant scoping matches the GUI.

## No inbound path

The task has no inbound ports, no public IP, and no load balancer. Reachability is exclusively ECS
Exec over SSM. See [../../../docs/ssh-access.md](../../../docs/ssh-access.md).

## Networking prerequisite

The private subnets (from foundation, P2) must reach AWS over VPC endpoints with no NAT. Ensure
foundation's `interface_endpoints` includes `bedrock-agentcore` (in addition to ssm, ssmmessages,
ec2messages, ecr.api, ecr.dkr, and logs) so the task can invoke the agent runtime privately.

## Deploy flow (human runs apply, agents do not)

```bash
cp backend.hcl.example backend.hcl             # edit with bootstrap outputs
cp terraform.tfvars.example terraform.tfvars   # edit with real values
terraform -chdir=infra/stacks/ssh-chat apply -target=aws_ecr_repository.cli   # create the repo
# docker build cli/, tag as <repo-url>:<image_tag>, docker push
terraform -chdir=infra/stacks/ssh-chat init -backend-config=backend.hcl
terraform -chdir=infra/stacks/ssh-chat plan
```

Agents may run `fmt`, `validate`, and `plan` only. A human runs `apply`.
