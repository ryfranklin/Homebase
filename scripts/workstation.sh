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

# Egress path. With the stoppable 'nat_instance', the scheduler stops the NAT together
# with the workstation, so a hand-start must bring the NAT back too or the box has SSM
# (via VPC endpoints) but no internet (STS/Bedrock/git/npm hang). 'nat_gateway' is
# managed + always-on, so there is nothing to start.
NAT_EGRESS="${WS_NAT_EGRESS:-$(tf_output nat_egress_type)}"

# Resolve the stoppable NAT instance id: WS_NAT_INSTANCE_ID override, then the stack's
# nat_instance_id output, then a fallback derived from the workstation's Name tag (so it
# works even before that output is applied). Empty when there is no stoppable NAT.
resolve_nat_id() {
  [ "$NAT_EGRESS" = "nat_gateway" ] && return 0
  if [ -n "${WS_NAT_INSTANCE_ID:-}" ]; then echo "$WS_NAT_INSTANCE_ID"; return 0; fi
  local id; id="$(tf_output nat_instance_id)"
  if [ -n "$id" ]; then echo "$id"; return 0; fi
  local ws_name
  ws_name="$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --region "$REGION" \
    --query 'Reservations[0].Instances[0].Tags[?Key==`Name`]|[0].Value' --output text 2>/dev/null || true)"
  [ -n "$ws_name" ] && [ "$ws_name" != "None" ] || return 0
  aws ec2 describe-instances --region "$REGION" \
    --filters "Name=tag:Name,Values=${ws_name}-nat" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null | grep -v '^None$' || true
}
NAT_ID="$(resolve_nat_id)"

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

nat_state() {
  aws ec2 describe-instances --instance-ids "$1" --region "$REGION" \
    --query 'Reservations[0].Instances[0].State.Name' --output text 2>/dev/null || echo unknown
}

# Bring the stoppable NAT back up so the workstation has egress. Best-effort: a failure
# here must not block opening the shell (SSM still works without the NAT).
ensure_nat_started() {
  if [ -z "$NAT_ID" ]; then
    [ "$NAT_EGRESS" = "nat_gateway" ] || echo "note: no stoppable NAT resolved; if egress hangs, start the NAT manually." >&2
    return 0
  fi
  local s; s="$(nat_state "$NAT_ID")"
  case "$s" in
    running) ;;
    stopped) echo "starting NAT $NAT_ID (restoring egress)..." >&2
      aws ec2 start-instances --instance-ids "$NAT_ID" --region "$REGION" >/dev/null 2>&1 || { echo "warning: could not start the NAT." >&2; return 0; }
      aws ec2 wait instance-running --instance-ids "$NAT_ID" --region "$REGION" 2>/dev/null || true ;;
    *) echo "NAT is '$s'; waiting for it to run..." >&2
      aws ec2 wait instance-running --instance-ids "$NAT_ID" --region "$REGION" 2>/dev/null || true ;;
  esac
}

stop_nat() {
  [ -n "$NAT_ID" ] || return 0
  echo "stopping NAT $NAT_ID..." >&2
  aws ec2 stop-instances --instance-ids "$NAT_ID" --region "$REGION" >/dev/null 2>&1 || echo "warning: could not stop the NAT." >&2
}

ensure_started() {
  local s; s="$(state)"
  case "$s" in
    running) ;;
    stopped) echo "starting $INSTANCE_ID..." >&2; aws ec2 start-instances --instance-ids "$INSTANCE_ID" --region "$REGION" >/dev/null; wait_running ;;
    *) echo "instance is '$s'; waiting for it to settle..." >&2; wait_running ;;
  esac
  ensure_nat_started   # restore egress (the NAT stops with the box under scheduled auto-stop)
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
    stop_nat   # bring egress down too so a stopped workstation costs ~nothing
    echo "stop requested. (The nightly schedule also stops the workstation and the NAT instance.)"
    ;;
  status)
    printf 'instance: %s\nstate:    %s\nssm:      %s\nregion:   %s\n' \
      "$INSTANCE_ID" "$(state)" "$(ssm_ping || echo unknown)" "$REGION"
    if [ -n "$NAT_ID" ]; then
      printf 'nat:      %s (%s)\n' "$NAT_ID" "$(nat_state "$NAT_ID")"
    elif [ "$NAT_EGRESS" = "nat_gateway" ]; then
      printf 'nat:      managed NAT gateway (always-on)\n'
    fi
    ;;
  *)
    echo "usage: $0 {connect|start|stop|status}" >&2
    exit 2
    ;;
esac
