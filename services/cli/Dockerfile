# Thin chat CLI image for the ssh-chat Fargate service.
#
# The task is reached only via ECS Exec (no inbound ports, no public IP). The
# container stays alive with a no-op main process; operators exec a shell and run
# `homebase-cli`. All configuration (agent runtime arn, user/tenant identity,
# region) arrives as environment variables set on the task definition in the
# ssh-chat Terraform stack. No account id, arn, or secret is baked in.
#
# Build for the task's CPU architecture. The ssh-chat task definition pins ARM64
# (task_cpu_architecture), so build linux/arm64 (native on Apple Silicon):
#   docker buildx build --platform linux/arm64 -t <repo>:<tag> --load .
FROM public.ecr.aws/docker/library/python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY pyproject.toml ./
COPY src ./src

RUN pip install --no-cache-dir .

# One task runs; ECS Exec is the only way in. Stay alive so operators can exec a
# shell and run `homebase-cli`.
CMD ["sleep", "infinity"]
