#!/usr/bin/env bash
#
# Run one eval benchmark on demand (the stack has no schedule by design).
#
# Launches the eval Fargate task to completion. Cluster, task definition, subnet,
# and security group are resolved from SSM (published by the eval stack), so no
# ids are baked in here. The task's model set, judge, table, and bucket come from
# the task definition's environment; override the model set or judge per run with
# EVAL_MODELS / EVAL_JUDGE.
#
# Usage:  ./scripts/run-eval.sh
# Env:    AWS_REGION (default us-east-1), HOMEBASE_PROJECT (homebase), HOMEBASE_ENV (prod)
#         HOMEBASE_AWS_ACCOUNT_ID (optional): when set, refuse to run unless the live
#         AWS caller is that account (guards against a wrong AWS_PROFILE)
#         EVAL_MODELS, EVAL_JUDGE (optional per-run overrides)

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PROJECT="${HOMEBASE_PROJECT:-homebase}"
ENV="${HOMEBASE_ENV:-prod}"

ssm() { aws ssm get-parameter --name "/$PROJECT/$ENV/eval/$1" --region "$REGION" --query 'Parameter.Value' --output text; }

# --- account guard: refuse to run against the wrong AWS account ---
# The expected account is an INPUT (never a literal here, since this repo is
# public): export HOMEBASE_AWS_ACCOUNT_ID to the prod account id. When set, the
# script aborts unless the live caller matches it (guards against a wrong AWS_PROFILE).
CALLER_ACCOUNT="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" || {
  echo "Not authenticated to AWS (token expired?). Run: aws sso login --profile <your-prod-profile>"
  exit 1
}
if [ -n "${HOMEBASE_AWS_ACCOUNT_ID:-}" ] && [ "$CALLER_ACCOUNT" != "$HOMEBASE_AWS_ACCOUNT_ID" ]; then
  echo "Refusing to run: current AWS account $CALLER_ACCOUNT does not match \$HOMEBASE_AWS_ACCOUNT_ID."
  echo "You are probably on the wrong AWS_PROFILE (current: ${AWS_PROFILE:-default})."
  exit 1
fi
if [ -z "${HOMEBASE_AWS_ACCOUNT_ID:-}" ]; then
  echo "NOTE: HOMEBASE_AWS_ACCOUNT_ID is not set, so the account guard is OFF. Current account: $CALLER_ACCOUNT (profile: ${AWS_PROFILE:-default})."
fi

CLUSTER="$(ssm cluster_name)"
TASKDEF="$(ssm task_definition_arn)"
SUBNET="$(ssm subnet_id)"
SG="$(ssm security_group_id)"

NET="awsvpcConfiguration={subnets=[$SUBNET],securityGroups=[$SG],assignPublicIp=DISABLED}"

# Optional per-run overrides of the model set / judge, passed as container env.
OVERRIDES=""
if [ -n "${EVAL_MODELS:-}" ] || [ -n "${EVAL_JUDGE:-}" ]; then
  ENVJSON=""
  [ -n "${EVAL_MODELS:-}" ] && ENVJSON="{\"name\":\"EVAL_MODELS\",\"value\":\"$EVAL_MODELS\"}"
  if [ -n "${EVAL_JUDGE:-}" ]; then
    [ -n "$ENVJSON" ] && ENVJSON="$ENVJSON,"
    ENVJSON="$ENVJSON{\"name\":\"EVAL_JUDGE\",\"value\":\"$EVAL_JUDGE\"}"
  fi
  OVERRIDES="--overrides {\"containerOverrides\":[{\"name\":\"eval\",\"environment\":[$ENVJSON]}]}"
fi

printf '\n==> Launching eval task on cluster %s\n' "$CLUSTER"
# shellcheck disable=SC2086
aws ecs run-task \
  --cluster "$CLUSTER" \
  --task-definition "$TASKDEF" \
  --launch-type FARGATE \
  --network-configuration "$NET" \
  --region "$REGION" \
  $OVERRIDES \
  --query 'tasks[0].taskArn' --output text

printf '\n==> Task launched. Watch logs in the eval CloudWatch log group; results land in DynamoDB + S3.\n'
