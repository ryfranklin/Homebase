# Container image for the AgentCore Runtime.
#
# The AgentCore Runtime HTTP contract: serve POST /invocations and GET /ping on
# port 8080. observability is provided by the AWS Distro for OpenTelemetry
# (ADOT); the runtime is started under opentelemetry-instrument when
# AGENT_OBSERVABILITY_ENABLED=true (env vars are set on the runtime in the agent
# Terraform stack).
#
# No account, model id, or knowledge base id is baked in; all configuration
# arrives as environment variables at runtime.

FROM public.ecr.aws/docker/library/python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY pyproject.toml ./
COPY src ./src

# The system prompt ships as package data under src/homebase_agent/prompts, so it
# is installed with the package; no separate COPY of a repo-level prompts/ dir.
RUN pip install --no-cache-dir '.[live]' aws-opentelemetry-distro>=0.10.0

EXPOSE 8080

# opentelemetry-instrument wraps the server so traces flow to CloudWatch when
# observability is enabled; it is a no-op passthrough otherwise.
CMD ["opentelemetry-instrument", "python", "-m", "homebase_agent.server"]
