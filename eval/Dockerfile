FROM public.ecr.aws/docker/library/python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY pyproject.toml ./
COPY src ./src
COPY fixtures ./fixtures

# Install with the [live] extra (boto3) for the deployed batch runner.
RUN pip install --no-cache-dir '.[live]'

# The deployed eval task runs one benchmark and persists results, then exits.
# Config comes from the task definition's environment (EVAL_MODELS, EVAL_JUDGE,
# EVAL_TABLE, EVAL_BUCKET, ...). No inbound; this is a run-to-completion task.
CMD ["homebase-eval-batch"]
