#!/usr/bin/env bash
#
# Build, verify, push, and deploy the vault-worker container in one step.
#
# The vault-worker CODE lives in this repo (services/vault-worker); its ECR repo and
# Fargate service live in this repo's `vault-worker` Terraform stack. This script builds
# the image, pushes it to ECR under a unique tag, bumps `image_tag` in the stack's
# tfvars, and runs `terraform apply` (which YOU confirm — Terraform is never auto-applied).
#
# Why a unique tag: a mutable tag Terraform can't detect as a change, so `apply` would
# not roll the service. A fresh tag each deploy makes the task-definition update explicit
# and rules out stale-tag reuse.
#
# No account id or secret is baked in: the ECR repository is resolved at run time.
#
# Usage:  AWS_PROFILE=<prod-profile> ./scripts/deploy-vault-worker.sh
# Env:    AWS_REGION (default us-east-1), HOMEBASE_PROJECT (homebase), HOMEBASE_ENV (prod)
#         HOMEBASE_AWS_ACCOUNT_ID (optional): when set, the script refuses to run unless
#         the live AWS caller is that account (guards against a wrong AWS_PROFILE).
#
# PREREQUISITE: merge your worker change and `git pull` main FIRST — this builds whatever
# is checked out in services/vault-worker right now.

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PROJECT="${HOMEBASE_PROJECT:-homebase}"
ENV="${HOMEBASE_ENV:-prod}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_DIR="$REPO_ROOT/services/vault-worker"
WORKER_STACK="$REPO_ROOT/infra/stacks/vault-worker"
TFVARS="$WORKER_STACK/terraform.tfvars"

log() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ -f "$WORKER_DIR/Dockerfile" ] || die "no Dockerfile at $WORKER_DIR"

# --- account guard: refuse to deploy to the wrong AWS account ---
# The expected account is an INPUT (never a literal here, since this repo is public):
# export HOMEBASE_AWS_ACCOUNT_ID to the prod account id. When set, the script aborts
# unless the live caller matches it — failing fast instead of a confusing mid-apply error.
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

# Show exactly what will ship, and warn (don't block) if it isn't clean main — a
# reminder that this builds the working tree, not necessarily what's merged.
HEAD="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')"
BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
printf '    building services/vault-worker at commit %s on %s\n' "$HEAD" "$BRANCH"
[ "$BRANCH" = "main" ] || printf '    WARNING: not on main — building %s\n' "$BRANCH"
git -C "$REPO_ROOT" diff --quiet -- "$WORKER_DIR" 2>/dev/null || printf '    WARNING: services/vault-worker has uncommitted changes\n'

log "Resolving ECR repository ($PROJECT-$ENV-vault-worker)"
ECR_URL="$(aws ecr describe-repositories --repository-names "$PROJECT-$ENV-vault-worker" \
  --region "$REGION" --query 'repositories[0].repositoryUri' --output text)"
REGISTRY="${ECR_URL%/*}"
# A unique, always-new tag forces the service to update and rules out stale-tag reuse.
TAG="deploy-$(date +%Y%m%d-%H%M%S)"
IMAGE="$ECR_URL:$TAG"
log "Target image: $IMAGE"

log "Logging in to the private ECR (push)"
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"

log "Building (arm64, --no-cache) from $WORKER_DIR"
docker build --no-cache --platform linux/arm64 -t "$IMAGE" "$WORKER_DIR"

log "Verifying the built image is well-formed (runtime + entry modules present)"
docker run --rm --entrypoint sh "$IMAGE" -c '
  node --version >/dev/null \
    && npx --no-install tsx --version >/dev/null \
    && test -f src/index.ts && test -f src/mirror.ts && test -f src/gitvault.ts \
    && echo "verify OK: node + tsx + entry modules present"
'

log "Pushing $IMAGE"
docker push "$IMAGE"

log "Setting image_tag = \"$TAG\" in terraform.tfvars"
if [ -f "$TFVARS" ] && grep -q '^image_tag' "$TFVARS"; then
  tmp="$(mktemp)"
  sed "s|^image_tag.*|image_tag = \"$TAG\"|" "$TFVARS" >"$tmp" && mv "$tmp" "$TFVARS"
else
  echo "image_tag = \"$TAG\"" >>"$TFVARS"
fi

log "terraform init (providers + backend; idempotent — so a fresh checkout doesn't fail apply)"
terraform -chdir="$WORKER_STACK" init -backend-config=backend.hcl -input=false >/dev/null

log "terraform apply (you will be prompted to confirm the change)"
terraform -chdir="$WORKER_STACK" apply

log "Done. The Fargate service rolls to the new task revision. Watch it:
    aws ecs describe-services --cluster $PROJECT-$ENV-vault-worker --services $PROJECT-$ENV-vault-worker \\
      --query 'services[0].deployments[].{status:status,running:runningCount,desired:desiredCount,rollout:rolloutState}' --output table
Then confirm the churn stopped: the worker log emits \"vault_synced\" only on a real
commit (no per-poll re-put), so the corpus bucket's noncurrent versions stop growing."
