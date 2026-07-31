# Reaching the thin chat CLI over SSM

The chat CLI runs as an ECS Fargate task in a private subnet with no inbound ports and no public IP.
The only way in is ECS Exec over AWS Systems Manager (SSM). This document shows how, from a laptop
and from a phone or tablet. All values are placeholders; use your own.

## Prerequisites

- AWS credentials via SSO (`aws login`), with permission to run `ecs execute-command` on the service.
- The Session Manager plugin for the AWS CLI installed locally.
- The cluster and service names, published to SSM:
  - `/homebase/<env>/cli/cluster_name`
  - `/homebase/<env>/cli/service_name`

## From a laptop (ECS Exec)

Find the running task, then exec an interactive shell into it:

```bash
CLUSTER=$(aws ssm get-parameter --name /homebase/<env>/cli/cluster_name --query Parameter.Value --output text)
SERVICE=$(aws ssm get-parameter --name /homebase/<env>/cli/service_name --query Parameter.Value --output text)

TASK_ARN=$(aws ecs list-tasks --cluster "$CLUSTER" --service-name "$SERVICE" \
  --query 'taskArns[0]' --output text)

aws ecs execute-command \
  --cluster "$CLUSTER" \
  --task "$TASK_ARN" \
  --container cli \
  --interactive \
  --command "/bin/sh"
```

Then run the chat client inside the container:

```bash
homebase-cli                    # interactive REPL
homebase-cli --prompt "..."     # one-shot
```

The exec data channel is KMS-encrypted and logged to CloudWatch
(`/homebase/<env>/cli/exec`), so sessions are auditable.

## From a phone or tablet (SSH-over-SSM via Blink / Termius)

ECS Exec itself is not raw SSH, but you can reach the same box from a mobile SSH app by tunneling SSH
over an SSM session. The pattern:

1. Install a mobile SSH client that supports ProxyCommand or SSM (for example Blink Shell or Termius)
   and configure your AWS SSO profile on the device (or use a bastion you already reach over SSM).
2. Use an SSM `ProxyCommand` so the SSH transport rides the SSM data channel, for example:

   ```
   Host homebase-cli
     ProxyCommand sh -c "aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p"
     User <YOUR_SSH_USER>
   ```

   For ECS Exec specifically, the mobile flow is usually: open an SSM session to the task's managed
   instance / exec target, then run `homebase-cli`. On tablets, running the AWS CLI in a mobile Linux
   shell (for example iSH or a-Shell) and invoking the same `aws ecs execute-command` as above is the
   simplest path.

3. There are no inbound ports on the task; the mobile client reaches it only through the SSM data
   channel, exactly like the laptop path.

## Security notes

- No long-lived credentials on the device: authentication is your short-lived SSO session, and the
  task uses its IAM role via container credentials.
- No inbound network path exists to the task; SSM is the sole entry.
- The task role can invoke only the agent runtime. It cannot read the knowledge base, S3, or Secrets
  Manager. Retrieval happens inside the agent.
