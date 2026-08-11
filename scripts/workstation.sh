#!/usr/bin/env bash
# Homebase workstation control: connect / start / stop / status.
#
# The workstation is SSM-only (no inbound, no public IP, no key pair) and
# auto-stops nightly, so day-to-day use is: start it, wait for the SSM agent to
# come Online, then open a Session Manager shell. This wraps that.
#
# No account id or instance id is hardcoded: the instance id is resolved from the
# workstation stack's Terraform output (or the WS_INSTANCE_ID env var). Region is
# the stack's aws_region output, or AWS_REGION, or us-east-1.
#
# Usage:
#   scripts/workstation.sh connect   # start if stopped, wait for SSM, open a shell (default)
#   scripts/workstation.sh start     # start only
#   scripts/workstation.sh stop      # stop the workstation (the 3am schedule also stops it + NAT)
#   scripts/workstation.sh status    # instance state + SSM ping status
#
# Requires: aws CLI v2, and (for connect) the AWS Session Manager plugin.
set -euo pipefail

STACK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../infra/stacks/workstation" && pwd)"

tf_output() { terraform -chdir="$STACK_DIR" output -raw "$1" 2>/dev/null || true; }

REGION="${AWS_REGION:-$(tf_output aws_region)}"
REGION="${REGION:-us-east-1}"
INSTANCE_ID="${WS_INSTANCE_ID:-$(tf_output instance_id)}"

if [ -z "$INSTANCE_ID" ]; then
  echo "error: could not resolve the workstation instance id." >&2
  echo "  set WS_INSTANCE_ID, or run from a checkout where 'terraform -chdir=$STACK_DIR output instance_id' works." >&2
  exit 1
fi

state() {
  aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --region "$REGION" \
    --query 'Reservations[0].Instances[0].State.Name' --output text
}

ssm_ping() {
  aws ssm describe-instance-information --region "$REGION" \
    --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
    --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true
}

wait_running() {
  echo "waiting for instance to be running..." >&2
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"
}

wait_ssm_online() {
  echo "waiting for the SSM agent to come Online..." >&2
  for _ in $(seq 1 60); do
    [ "$(ssm_ping)" = "Online" ] && return 0
    sleep 5
  done
  echo "error: SSM agent did not report Online in time." >&2
  return 1
}

ensure_started() {
  local s; s="$(state)"
  case "$s" in
    running) ;;
    stopped) echo "starting $INSTANCE_ID..." >&2; aws ec2 start-instances --instance-ids "$INSTANCE_ID" --region "$REGION" >/dev/null; wait_running ;;
    *) echo "instance is '$s'; waiting for it to settle..." >&2; wait_running ;;
  esac
  wait_ssm_online
}

cmd="${1:-connect}"
case "$cmd" in
  connect)
    ensure_started
    echo "opening a Session Manager shell on $INSTANCE_ID ($REGION)..." >&2
    exec aws ssm start-session --target "$INSTANCE_ID" --region "$REGION"
    ;;
  start)
    ensure_started
    echo "$INSTANCE_ID is running and SSM Online."
    ;;
  stop)
    echo "stopping $INSTANCE_ID..." >&2
    aws ec2 stop-instances --instance-ids "$INSTANCE_ID" --region "$REGION" >/dev/null
    echo "stop requested. (The nightly schedule also stops the workstation and the NAT instance.)"
    ;;
  status)
    printf 'instance: %s\nstate:    %s\nssm:      %s\nregion:   %s\n' \
      "$INSTANCE_ID" "$(state)" "$(ssm_ping || echo unknown)" "$REGION"
    ;;
  *)
    echo "usage: $0 {connect|start|stop|status}" >&2
    exit 2
    ;;
esac
