#!/usr/bin/env bash
#
# Build, verify, push, and deploy the Mission Control container in one step.
#
# Mission Control's CODE lives in a SEPARATE repo (the Mission-Control checkout); its
# ECR repo and Fargate service live in THIS repo's `mission-control` Terraform stack.
# So this script builds the image from the MC repo, pushes it to Homebase's ECR under a
# unique tag, bumps `image_tag` in the stack's tfvars, and runs `terraform apply` (which
# YOU confirm — Terraform is never auto-applied).
#
# Why a unique tag: the service historically ran a mutable `:latest`, which Terraform
# can't detect as a change (so `apply` won't roll it). A fresh tag each deploy makes the
# task-definition update explicit and rules out stale-tag reuse.
#
# No account id or secret is baked in: the ECR repository is resolved at run time.
#
# Usage:  AWS_PROFILE=<profile> ./scripts/deploy-mission-control.sh
# Env:    AWS_REGION (default us-east-1), HOMEBASE_PROJECT (homebase), HOMEBASE_ENV (prod),
#         MC_REPO (default: the sibling ../Mission-Control checkout)
#
# PREREQUISITE: merge your Mission Control change and `git pull` its main FIRST — this
# builds whatever is checked out in MC_REPO right now.

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PROJECT="${HOMEBASE_PROJECT:-homebase}"
ENV="${HOMEBASE_ENV:-prod}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MC_REPO="${MC_REPO:-$(cd "$REPO_ROOT/.." && pwd)/Mission-Control}"
MC_STACK="$REPO_ROOT/infra/stacks/mission-control"
TFVARS="$MC_STACK/terraform.tfvars"

log() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ -f "$MC_REPO/Dockerfile" ] || die "no Dockerfile at MC_REPO=$MC_REPO (set MC_REPO to your Mission-Control checkout)"

log "Building from Mission Control checkout: $MC_REPO"
# Show exactly what will ship, and warn (don't block) if it isn't clean main — a
# reminder that this builds the working tree, not necessarily what's merged.
MC_HEAD="$(git -C "$MC_REPO" rev-parse --short HEAD 2>/dev/null || echo '?')"
MC_BRANCH="$(git -C "$MC_REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
printf '    commit %s on %s\n' "$MC_HEAD" "$MC_BRANCH"
[ "$MC_BRANCH" = "main" ] || printf '    WARNING: not on main — building %s\n' "$MC_BRANCH"
git -C "$MC_REPO" diff --quiet 2>/dev/null || printf '    WARNING: working tree is dirty — building uncommitted changes\n'

log "Resolving ECR repository ($PROJECT-$ENV-mission-control)"
ECR_URL="$(aws ecr describe-repositories --repository-names "$PROJECT-$ENV-mission-control" \
  --region "$REGION" --query 'repositories[0].repositoryUri' --output text)"
REGISTRY="${ECR_URL%/*}"
# A unique, always-new tag forces the service to update and rules out stale-tag reuse.
TAG="deploy-$(date +%Y%m%d-%H%M%S)"
IMAGE="$ECR_URL:$TAG"
log "Target image: $IMAGE"

log "Logging in to the private ECR (push)"
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"

log "Building (arm64, --no-cache) from $MC_REPO"
docker build --no-cache --platform linux/arm64 -t "$IMAGE" "$MC_REPO"

log "Verifying the built image imports cleanly (deps + code load; catches a broken build)"
docker run --rm --entrypoint python "$IMAGE" -c "
import mission_control.service.app       # noqa: F401  fastapi + psycopg/libpq load
import mission_control.service.manager   # noqa: F401  the run manager loads
import mission_control.eval_gate_mcp     # noqa: F401  the MCP eval-gate server loads
print('verify OK: service, manager, and eval-gate MCP modules import')
"

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
terraform -chdir="$MC_STACK" init -backend-config=backend.hcl -input=false >/dev/null

log "terraform apply (you will be prompted to confirm the change)"
terraform -chdir="$MC_STACK" apply

log "Done. The Fargate service rolls to the new task revision (watch: aws ecs describe-services \
--cluster $PROJECT-$ENV-mission-control --services $PROJECT-$ENV-mission-control). Then re-run \
the Mission Control smoke test."
