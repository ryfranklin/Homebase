#!/usr/bin/env bash
#
# Build and deploy the Homebase SPA locally: build the Vite bundle, sync it to the
# web S3 origin, and invalidate CloudFront. This mirrors the CI `deploy-web` job but
# runs on your machine and needs NO repo Secrets:
#   - the S3 bucket + CloudFront id come from the `web` stack's Terraform outputs
#   - the VITE_* build config comes from web/.env.local (git-ignored), which Vite
#     loads automatically at build time (see web/.env.example)
#
# It never runs terraform apply and never touches infrastructure. No account id or
# secret is baked in; the bucket/distribution are resolved at run time.
#
# Usage:  ./scripts/deploy-web.sh
# Env:    AWS_PROFILE (MUST be the prod account), AWS_REGION (default us-east-1)
#         HOMEBASE_AWS_ACCOUNT_ID (optional): when set, the script refuses to run
#         unless the live AWS caller is that account (guards against a wrong AWS_PROFILE)

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_STACK="$REPO_ROOT/infra/stacks/web"

log() { printf '\n==> %s\n' "$*"; }

command -v aws >/dev/null 2>&1 || { echo "aws CLI not found on PATH"; exit 1; }
command -v terraform >/dev/null 2>&1 || { echo "terraform not found on PATH"; exit 1; }
if [ ! -f "$REPO_ROOT/web/.env.local" ]; then
  echo "web/.env.local not found. Copy web/.env.example to web/.env.local and fill in your VITE_* values first."
  exit 1
fi

# --- account guard: refuse to deploy to the wrong AWS account ---
# The expected account is an INPUT (never a literal here, since this repo is
# public): export HOMEBASE_AWS_ACCOUNT_ID (e.g. in your shell profile) to the prod
# account id. When set, the script aborts unless the live caller matches it.
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

log "Resolving the web bucket + CloudFront distribution from the web stack outputs"
# The web stack must be initialized locally (terraform init with its backend.hcl).
BUCKET="$(terraform -chdir="$WEB_STACK" output -raw static_bucket_name 2>/dev/null)" || {
  echo "Could not read web stack outputs. Initialize it first:"
  echo "  terraform -chdir=infra/stacks/web init -backend-config=backend.hcl"
  exit 1
}
DIST_ID="$(terraform -chdir="$WEB_STACK" output -raw distribution_id)"
log "Bucket: $BUCKET   Distribution: $DIST_ID"

log "Building the SPA (Vite reads web/.env.local)"
(cd "$REPO_ROOT/web" && npm ci && npm run build)

# Hashed assets are immutable: cache them forever. index.html must NEVER be
# stale-cached, or it references deleted chunk hashes and lazy imports 404. So
# upload the hashed assets first (long cache), then index.html no-cache.
log "Syncing hashed assets to S3 (immutable cache)"
aws s3 sync "$REPO_ROOT/web/dist" "s3://$BUCKET/" --delete --region "$REGION" \
  --exclude "index.html" --cache-control "public,max-age=31536000,immutable"

log "Uploading index.html (no-cache)"
aws s3 cp "$REPO_ROOT/web/dist/index.html" "s3://$BUCKET/index.html" --region "$REGION" \
  --cache-control "no-cache,must-revalidate" --content-type "text/html"

log "Invalidating CloudFront"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" \
  --query 'Invalidation.Id' --output text

log "Done. The SPA (merged Vault+Chat, scope toggle, chat memory, Evals tab) is deploying. Give CloudFront ~1 minute, then hard-reload the app."
