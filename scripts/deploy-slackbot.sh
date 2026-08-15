#!/usr/bin/env bash
#
# Build, verify, push, and redeploy the Homebase Slack bridge container in one step.
#
# Why this exists: three foot-guns bit us deploying this by hand. (1) The image must
# be linux/arm64 (the task pins ARM64) and a stale `docker build` silently ships old
# code. (2) In zsh, `$ECR:latest` triggers the `:l` lowercase modifier and mangles
# the tag -> this script only ever uses braced expansion. (3) The task definition
# references the :latest tag, so a redeploy is a `docker push` of :latest plus an ECS
# `--force-new-deployment` -- NOT a terraform run. This script does exactly that and
# nothing else, so it can never touch Terraform state.
#
# No account id or secret is baked in: the ECR repo, cluster, and service are all
# resolved from AWS at run time. Terraform is NOT invoked (the stack is already
# applied; image redeploys do not need it). If you changed the STACK (not the image),
# run `terraform -chdir=infra/stacks/slackbot apply` yourself instead.
#
# Prereq: the slackbot stack must already be applied (this reads resources it created).
# For the very first deploy, apply the stack in two steps (ECR repo first), then run
# this: see infra/stacks/slackbot/README.md.
#
# Usage:  ./scripts/deploy-slackbot.sh
# Env:    AWS_REGION (default us-east-1), HOMEBASE_PROJECT (homebase), HOMEBASE_ENV (prod)

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PROJECT="${HOMEBASE_PROJECT:-homebase}"
ENV="${HOMEBASE_ENV:-prod}"
PLATFORM="linux/arm64" # the task definition pins ARM64; the image must match

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SLACKBOT_DIR="${REPO_ROOT}/services/slackbot"
REPO_NAME="${PROJECT}-${ENV}-slackbot"

log() { printf '\n==> %s\n' "$*"; }

log "Resolving the ECR repository (${REPO_NAME})"
ECR_URL="$(aws ecr describe-repositories --repository-names "${REPO_NAME}" \
  --region "${REGION}" --query 'repositories[0].repositoryUrl' --output text 2>/dev/null)" || {
  echo "ERROR: ECR repo ${REPO_NAME} not found. Apply the slackbot stack first" >&2
  echo "       (two-step: terraform apply -target=aws_ecr_repository.this, then this script)." >&2
  exit 1
}
REGISTRY="${ECR_URL%%/*}" # <account>.dkr.ecr.<region>.amazonaws.com

# A unique dated tag for provenance; :latest is what the task definition runs.
TAG="deploy-$(date +%Y%m%d-%H%M%S)"
IMAGE="${ECR_URL}:${TAG}"
LATEST="${ECR_URL}:latest"
log "Target image: ${IMAGE} (also tagging :latest)"

log "Resolving cluster/service from SSM"
CLUSTER="$(aws ssm get-parameter --name "/${PROJECT}/${ENV}/slackbot/cluster_name" \
  --region "${REGION}" --query 'Parameter.Value' --output text)"
SERVICE="$(aws ssm get-parameter --name "/${PROJECT}/${ENV}/slackbot/service_name" \
  --region "${REGION}" --query 'Parameter.Value' --output text)"
log "cluster=${CLUSTER}  service=${SERVICE}"

log "Logging in to ECR Public (base image pull) and the private ECR (push)"
aws ecr-public get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin public.ecr.aws
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${REGISTRY}"

log "Building (${PLATFORM}, --no-cache) from ${SLACKBOT_DIR}"
docker build --no-cache --platform "${PLATFORM}" -t "${IMAGE}" -t "${LATEST}" "${SLACKBOT_DIR}"

log "Verifying the built image imports before pushing"
docker run --rm --entrypoint python --platform "${PLATFORM}" "${IMAGE}" -c "
import homebase_slackbot.app        # noqa: F401  (Bolt wiring must import)
import homebase_slackbot.handlers   # noqa: F401
import homebase_slackbot.allowlist  # noqa: F401
import homebase_slackbot.agent_client  # noqa: F401
print('verify OK: slackbot image imports')
"

log "Pushing ${TAG} and :latest"
docker push "${IMAGE}"
docker push "${LATEST}"

log "Forcing a new ECS deployment so the service pulls the new image"
aws ecs update-service --cluster "${CLUSTER}" --service "${SERVICE}" \
  --force-new-deployment --region "${REGION}" >/dev/null

log "Done. Watch it connect:"
echo "    aws logs tail /${PROJECT}/${ENV}/slackbot/task --follow --region ${REGION}"
echo "    (expect: 'Bolt app is running!' and 'A new session has been established')"
