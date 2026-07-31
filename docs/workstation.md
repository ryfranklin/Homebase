# The cloud workstation

The workstation is a single EC2 instance in a private subnet, reached only over SSM. It is your
credentialed dev-and-ops box: you code and operate from it, but it holds no long-lived keys. All
values below are placeholders.

## Start and stop (including from a phone)

The box auto-stops when idle (scheduled or activity-based). To start or stop it by hand, from a
laptop or a mobile AWS console / CLI:

```bash
INSTANCE_ID=<YOUR_WORKSTATION_INSTANCE_ID>   # or from the workstation stack output

aws ec2 start-instances --instance-ids "$INSTANCE_ID"
aws ec2 stop-instances  --instance-ids "$INSTANCE_ID"
```

From a phone or tablet: the AWS Console mobile app (EC2 → start/stop) or any mobile shell with your
SSO profile works. When using the stoppable NAT instance, `scheduled` auto-stop turns off the NAT too,
so leaving the box stopped costs essentially nothing.

## Connect (SSM only)

```bash
aws ssm start-session --target "$INSTANCE_ID"
```

There is no key pair, no inbound port, and no public IP. Session Manager over SSM is the sole entry.
From a phone/tablet, use the same SSM session flow (see [ssh-access.md](./ssh-access.md) for the
SSH-over-SSM ProxyCommand pattern that mobile clients like Blink/Termius use).

## How role assumption works (no long-lived keys)

The instance role is scoped to the minimum: SSM Session Manager, reading its dotfiles/secret pointers,
and fetching the one shell secret. It is NOT admin.

For anything broader (deploying, operating other stacks), you assume a task-specific role for
short-lived credentials rather than storing keys:

```bash
# The instance role is allowed to assume roles listed in assumable_role_arns.
CREDS=$(aws sts assume-role \
  --role-arn <YOUR_TASK_ROLE_ARN> \
  --role-session-name workstation \
  --query Credentials --output json)
export AWS_ACCESS_KEY_ID=$(echo "$CREDS" | jq -r .AccessKeyId)
export AWS_SECRET_ACCESS_KEY=$(echo "$CREDS" | jq -r .SecretAccessKey)
export AWS_SESSION_TOKEN=$(echo "$CREDS" | jq -r .SessionToken)
# ... use the short-lived credentials, then let them expire.
```

These credentials are temporary and live only in the shell environment. Nothing is written to disk.

## No long-lived keys on disk, ever

- The instance never stores an access key. Credentials come from the instance role and from
  short-lived `sts:assume-role`.
- Your dotfiles are cloned from a private repo URL (kept out of this repo, surfaced via SSM), and your
  machine-local shell secret (the `~/.zshrc.local` pattern) is fetched from Secrets Manager at each
  login. Neither the secret nor the repo URL is baked into the AMI or committed.
- If you ever need a credential file, generate it from a short-lived assumed role and delete it when
  done. Do not persist long-lived keys.

## Egress cost note

Outbound internet (git clone, npm/pip, docker pull) goes through the NAT chosen by `nat_egress_type`:

- `nat_instance` (default): a small stoppable EC2 NAT. Cheapest; it stops with the workstation under
  scheduled auto-stop, so a stopped workstation has near-zero egress cost.
- `nat_gateway`: managed but always-on; it bills continuously (hourly + data) even while the
  workstation is stopped. Choose it only if you want the managed, multi-AZ option and accept the
  standing cost.
