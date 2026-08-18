#!/usr/bin/env bash
#
# Build, verify, push, and deploy the Homebase eval batch-runner container.
#
# Mirrors deploy-agent.sh: a unique image tag every time (a mutable :latest is
# ignored by the task definition), a VERIFY step that proves the built image
# contains runnable code before pushing, and an automatic tfvars tag bump. No
# account id or secret is baked in; the ECR repository is resolved from SSM at run
# time. Terraform is applied by YOU (the script runs `terraform apply`, which
# prompts) — it is never auto-approved.
#
# Usage:  ./scripts/deploy-eval.sh
# Env:    AWS_REGION (default us-east-1), HOMEBASE_PROJECT (homebase), HOMEBASE_ENV (prod)
#         HOMEBASE_AWS_ACCOUNT_ID (optional): when set, refuse to run unless the live
#         AWS caller is that account (guards against a wrong AWS_PROFILE)

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PROJECT="${HOMEBASE_PROJECT:-homebase}"
ENV="${HOMEBASE_ENV:-prod}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EVAL_DIR="$REPO_ROOT/eval"
EVAL_STACK="$REPO_ROOT/infra/stacks/eval"
TFVARS="$EVAL_STACK/terraform.tfvars"

log() { printf '\n==> %s\n' "$*"; }

# --- account guard: refuse to deploy to the wrong AWS account ---
# The expected account is an INPUT (never a literal here, since this repo is
# public): export HOMEBASE_AWS_ACCOUNT_ID to the prod account id. When set, the
# script aborts unless the live caller matches it (guards against a wrong AWS_PROFILE).
CALLER_ACCOUNT="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" || {
  echo "Not authenticated to AWS (token expired?). Run: aws sso login --profile <your-prod-profile>"
  exit 1
}
if [ -n "${HOMEBASE_AWS_ACCOUNT_ID:-}" ] && [ "$CALLER_ACCOUNT" != "$HOMEBASE_AWS_ACCOUNT_ID" ]; then
  echo "Refusing to deploy: current AWS account $CALLER_ACCOUNT does not match \$HOMEBASE_AWS_ACCOUNT_ID."
  echo "You are probably on the wrong AWS_PROFILE (current: ${AWS_PROFILE:-default})."
  exit 1
fi
if [ -z "${HOMEBASE_AWS_ACCOUNT_ID:-}" ]; then
  echo "NOTE: HOMEBASE_AWS_ACCOUNT_ID is not set, so the account guard is OFF. Current account: $CALLER_ACCOUNT (profile: ${AWS_PROFILE:-default})."
fi

log "Resolving ECR repository from SSM (/$PROJECT/$ENV/eval/ecr_repository_url)"
ECR_URL="$(aws ssm get-parameter --name "/$PROJECT/$ENV/eval/ecr_repository_url" \
  --region "$REGION" --query 'Parameter.Value' --output text)"
REGISTRY="${ECR_URL%/*}"
TAG="deploy-$(date +%Y%m%d-%H%M%S)"
IMAGE="$ECR_URL:$TAG"
log "Target image: $IMAGE"

log "Logging in to ECR Public (base image pull) and the private ECR (push)"
aws ecr-public get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin public.ecr.aws
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"

log "Building (arm64, --no-cache) from $EVAL_DIR"
docker build --no-cache --platform linux/arm64 -t "$IMAGE" "$EVAL_DIR"

log "Verifying the built image actually contains runnable code"
docker run --rm --entrypoint python "$IMAGE" -c "
import homebase_eval.batch_cli as b  # noqa: F401  (import must succeed)
from homebase_eval.batch import AwsSink, run_batch  # noqa: F401
b.build_arg_parser().parse_args(['--dry-run'])
print('verify OK: batch runner imports and parses')
"

log "Pushing $IMAGE"
docker push "$IMAGE"

log "Setting eval_image_tag = \"$TAG\" in terraform.tfvars"
if [ -f "$TFVARS" ] && grep -q '^eval_image_tag' "$TFVARS"; then
  tmp="$(mktemp)"
  sed "s|^eval_image_tag.*|eval_image_tag = \"$TAG\"|" "$TFVARS" >"$tmp" && mv "$tmp" "$TFVARS"
else
  echo "eval_image_tag = \"$TAG\"" >>"$TFVARS"
fi

log "terraform apply (you will be prompted to confirm the change)"
terraform -chdir="$EVAL_STACK" apply

log "Done. Run a benchmark with: ./scripts/run-eval.sh"
