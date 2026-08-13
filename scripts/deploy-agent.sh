#!/usr/bin/env bash
#
# Build, verify, push, and deploy the Homebase agent container in one step.
#
# Why this exists: the AgentCore runtime only picks up new code when the image TAG
# changes (a mutable :latest is ignored), and a stale `docker build` silently ships
# old code. Chasing those cost real time. This script always uses a unique tag,
# VERIFIES the built image actually contains the current code before pushing, and
# bumps the tfvars tag for you.
#
# No account id or secret is baked in: the ECR repository is resolved from SSM at
# run time. Terraform is applied by YOU (the script runs `terraform apply`, which
# prompts for confirmation) — it is never auto-approved.
#
# Usage:  ./scripts/deploy-agent.sh
# Env:    AWS_REGION (default us-east-1), HOMEBASE_PROJECT (homebase), HOMEBASE_ENV (prod)

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PROJECT="${HOMEBASE_PROJECT:-homebase}"
ENV="${HOMEBASE_ENV:-prod}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_DIR="$REPO_ROOT/services/agent"
AGENT_STACK="$REPO_ROOT/infra/stacks/agent"
TFVARS="$AGENT_STACK/terraform.tfvars"

log() { printf '\n==> %s\n' "$*"; }

log "Resolving ECR repository from SSM (/$PROJECT/$ENV/agent/ecr_repository_url)"
ECR_URL="$(aws ssm get-parameter --name "/$PROJECT/$ENV/agent/ecr_repository_url" \
  --region "$REGION" --query 'Parameter.Value' --output text)"
REGISTRY="${ECR_URL%/*}"
# A unique, always-new tag forces the runtime to update and rules out stale-tag reuse.
TAG="deploy-$(date +%Y%m%d-%H%M%S)"
IMAGE="$ECR_URL:$TAG"
log "Target image: $IMAGE"

log "Logging in to ECR Public (base image pull) and the private ECR (push)"
aws ecr-public get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin public.ecr.aws
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"

log "Building (arm64, --no-cache) from $AGENT_DIR"
docker build --no-cache --platform linux/arm64 -t "$IMAGE" "$AGENT_DIR"

log "Verifying the built image actually contains the current code"
docker run --rm --entrypoint python "$IMAGE" -c "
import homebase_agent.server  # noqa: F401  (import must succeed)
import homebase_agent.connectors as c
tools = {t['toolSpec']['name'] for t in c.CONNECTOR_TOOLS}
assert tools, 'no connector tools found in the image'
print('verify OK:', len(tools), 'connector tools:', ', '.join(sorted(tools)))
"

log "Pushing $IMAGE"
docker push "$IMAGE"

log "Setting agent_image_tag = \"$TAG\" in terraform.tfvars"
if [ -f "$TFVARS" ] && grep -q '^agent_image_tag' "$TFVARS"; then
  tmp="$(mktemp)"
  sed "s|^agent_image_tag.*|agent_image_tag = \"$TAG\"|" "$TFVARS" >"$tmp" && mv "$tmp" "$TFVARS"
else
  echo "agent_image_tag = \"$TAG\"" >>"$TFVARS"
fi

log "terraform apply (you will be prompted to confirm the change)"
terraform -chdir="$AGENT_STACK" apply

log "Done. Reload the Homebase GUI to start a fresh session on the new runtime."
