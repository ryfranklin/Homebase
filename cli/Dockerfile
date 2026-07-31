# Container image for the thin chat CLI, run as an ECS Fargate task.
#
# Credential-free by construction: no keys, tokens, or secrets are baked in. At
# runtime the task assumes its IAM role and boto3 picks up credentials from the
# ECS container credentials endpoint. Identity (runtime ARN, tenant, user) is
# supplied as task environment variables, not baked here.

FROM public.ecr.aws/docker/library/python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY pyproject.toml ./
COPY src ./src

RUN pip install --no-cache-dir '.[live]'

# The service task idles so it stays running with no inbound ports and no public
# IP. You reach it only via ECS Exec (SSM) and then run `homebase-cli`
# interactively (it is installed on PATH by the console_scripts entry point).
CMD ["sleep", "infinity"]
