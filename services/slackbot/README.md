# Homebase Slack bridge

Talk to Homebase from Slack. A [slack-bolt](https://slack.dev/bolt-python/) app
running in **Socket Mode**: it holds an outbound WebSocket to Slack, so there is
no inbound webhook, no public endpoint, and no request signing to verify. It runs
on a private Fargate task with NAT egress only (see `infra/stacks/slackbot`).

## What it does

1. Listens for **app mentions** (in channels) and **direct messages**.
2. Resolves the sender's **verified email** via `users.info`.
3. Gates on the **allow-list** (a by-hand SSM SecureString of allowed emails, the
   same pattern as the Cognito sign-up gate). Non-listed users are refused.
4. Invokes the **AgentCore runtime** with that email as the user identity and a
   stable per-thread session id (so the agent keeps memory within a thread),
   exactly like the ssh-chat CLI plane.
5. Posts the answer back in a thread, with a `*Sources*` footer when the agent
   cites knowledge-base passages, or an authorization link when a connector
   needs linking first.

The bridge is one door onto the same brain as the GUI and CLI. The Bedrock
Guardrail on the agent governs it too, since governance lives at the model call.

## Layout

- `src/homebase_slackbot/agent_client.py` — `InvokeAgentRuntime` wrapper. Reads the
  whole response and assembles one `AgentReply`, handling both the SSE tool-loop
  stream (the connector-enabled prod path) and the buffered JSON path.
- `src/homebase_slackbot/allowlist.py` — reads and caches the allow-list SecureString.
- `src/homebase_slackbot/handlers.py` — the pure bridge decision (resolve, gate,
  ask, format). No Slack imports, so it is unit-tested with fakes.
- `src/homebase_slackbot/app.py` — the thin Bolt Socket Mode adapter and `main()`.

## Configuration (task environment)

| Variable | Meaning |
| --- | --- |
| `SLACK_BOT_TOKEN` | `xoxb-...` bot token (secret; `chat:write`, `users:read.email`) |
| `SLACK_APP_TOKEN` | `xapp-...` app-level token (secret; Socket Mode `connections:write`) |
| `HOMEBASE_AGENT_RUNTIME_ARN` | AgentCore runtime to invoke |
| `HOMEBASE_TENANT_ID` | tenant presented to the agent (default `homebase`) |
| `HOMEBASE_SLACK_ALLOWLIST_PARAM` | SSM SecureString name holding allowed emails |
| `AWS_REGION` | region |

The two Slack tokens are injected from Secrets Manager by the execution role, so
no secret is ever baked into the image.

## Build and redeploy

Once the stack is applied, redeploy image changes with one command (build → verify →
push `:latest` → force a new ECS deployment; no Terraform, repo/cluster/service
resolved from AWS so no account id is baked in):

```
./scripts/deploy-slackbot.sh
```

Or build by hand for the task's CPU architecture (the stack pins ARM64 — always brace
the tag, `${ECR}:latest`, or zsh's `:l` modifier mangles it):

```
docker buildx build --platform linux/arm64 -t "${ECR}:latest" --load .
```

## Test

```
python3 -m unittest discover -s tests -p 'test_*.py'
```

Offline only: no AWS calls, no Slack calls. Fakes stand in for the runtime, SSM,
and the Slack client.
