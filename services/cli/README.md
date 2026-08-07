# services/cli

The thin chat CLI: a minimal client for the AgentCore agent runtime, run inside the ssh-chat Fargate
task and reached only over ECS Exec (SSM). It is the SSH-plane counterpart to the web GUI, with the
same grounded, cited answers (behavior parity).

## What it does

`homebase-cli` invokes the agent runtime with the same wire contract the BFF uses (`services/bff`):

- request payload: `{input, session_id, user_id, tenant_id}`
- response: `{answer, grounded, citations}`

Identity (`user_id`, `tenant_id`) is presented by the task, kept explicit per the multi-tenant seed.
The task's IAM role (`bedrock-agentcore:InvokeAgentRuntime` only) is the sole credential; nothing is
baked into the image.

## Configuration (env vars, set on the task definition)

`HOMEBASE_AGENT_RUNTIME_ARN` (required), `HOMEBASE_USER_ID`, `HOMEBASE_TENANT_ID`, `AWS_REGION`.

## Usage (inside the task, via ECS Exec)

```bash
homebase-cli                 # interactive REPL (one agent session for the run)
homebase-cli --prompt "..."  # one-shot
```

See [../../docs/ssh-access.md](../../docs/ssh-access.md) for how to reach the task.

## Test

```bash
cd services/cli
PYTHONPATH=src python -m unittest discover -s tests   # offline, no AWS
```

## Build and push (human runs this; the ssh-chat stack creates the ECR repo)

The task definition pins **ARM64**, so build `linux/arm64` (native on Apple Silicon):

```bash
REPO=$(aws ecr describe-repositories --repository-names homebase-<env>-cli \
  --query 'repositories[0].repositoryUri' --output text --region <region>)
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin "${REPO%/*}"
docker buildx build --platform linux/arm64 -t "${REPO}:latest" --load .
docker push "${REPO}:latest"
```
