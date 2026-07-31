# cli

A thin, containerized terminal chat client for the Homebase agent. It invokes the SAME AgentCore
runtime the GUI uses (behavior parity: same agent, same streamed output), rendered in a terminal.

## Thinner surface, credential-free

- No repository access and no long-lived cloud credentials. At runtime the ECS task assumes its IAM
  role and boto3 reads credentials from the ECS container credentials endpoint. Nothing is baked into
  the image.
- It talks only to the AgentCore runtime (via the task role), not Cognito and not the BFF. Retrieval,
  memory, and tools all happen inside the agent; the CLI never touches the knowledge base, S3, or
  Secrets Manager.
- Tenant and user identity come from task configuration (`HOMEBASE_TENANT_ID`, `HOMEBASE_USER_ID`),
  so tenant scoping matches the GUI and the multi-tenant seam stays intact.

## Config (env, from the ECS task)

`HOMEBASE_AGENT_RUNTIME_ARN`, `HOMEBASE_USER_ID`, `HOMEBASE_TENANT_ID`, `AWS_REGION`.

## Reaching it

The container has no inbound ports and no public IP; it idles (`sleep infinity`) and is reached only
via ECS Exec over SSM. See [../docs/ssh-access.md](../docs/ssh-access.md). Once you have a shell:

```bash
homebase-cli                       # interactive REPL
homebase-cli --prompt "what changed in the ops runbook?"   # one-shot
```

## Tests

```bash
cd cli
python -m unittest discover -s tests   # offline: fake agent client, no AWS
```
