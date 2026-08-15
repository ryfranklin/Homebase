# Homebase Slack bridge image for the slackbot Fargate service.
#
# Unlike the ssh-chat CLI image (which sleeps until an operator execs in), this
# runs a long-lived foreground process: a slack-bolt Socket Mode app that holds
# an OUTBOUND WebSocket to Slack. No inbound ports, no public IP. All config
# arrives as environment variables on the task definition in the slackbot
# Terraform stack; the three Slack/agent secrets are injected from Secrets
# Manager by the execution role. No account id, arn, or secret is baked in.
#
# Build for the task's CPU architecture. The task definition pins ARM64
# (task_cpu_architecture), so build linux/arm64 (native on Apple Silicon):
#   docker buildx build --platform linux/arm64 -t <repo>:<tag> --load .
FROM public.ecr.aws/docker/library/python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY pyproject.toml ./
COPY src ./src

RUN pip install --no-cache-dir .

# Long-lived: the Socket Mode handler blocks, holding the WebSocket to Slack.
CMD ["homebase-slackbot"]
