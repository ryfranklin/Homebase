# stacks/workstation

The isolated EC2 cloud workstation (ADR-005): the credentialed dev-and-ops box, reached over SSM.
This is the real blast radius, so it carries the strictest guardrails in the build. State lives
remotely in the bootstrap bucket.

## What it creates

- A single EC2 instance in a dedicated private subnet: SSM-only (no key pair, no inbound ports, no
  public IP), IMDSv2 required, KMS-encrypted root volume and a separate KMS-encrypted persistent home
  volume (mounted at `/workspace`, kept across stops).
- A scoped instance role that is NOT admin (see below).
- An outbound-only egress path (internet gateway + public subnet holding only the NAT + a private
  route to the NAT). Adding egress adds no inbound path and no public IP on the instance.
- An auto-stop-when-idle mechanism so the box is neither a standing cost nor a standing target.

## The instance role is NOT admin

The role is scoped to exactly what the box needs: the SSM Session Manager baseline
(`AmazonSSMManagedInstanceCore`), reading its own dotfiles/secret pointers from SSM, fetching the one
shell secret from Secrets Manager, and decrypting it. Anything broad is reached by ASSUMING a
task-specific role (`assumable_role_arns`) for short-lived credentials, never through standing
instance permissions and never through stored keys. There is no `AdministratorAccess`, no `*:*`, and
no action `"*"` on this role.

## Egress: outbound-only, parameterized

`nat_egress_type` chooses the egress path and defaults to `nat_instance` (a small EC2 NAT that stops
with the workstation, so egress cost stops too). `nat_gateway` is the managed alternative but is
always-on and pricier (hourly + data). Cost tradeoff:

- `nat_instance` (default): cheapest; a `t4g.nano` you stop alongside the workstation. Slightly less
  managed (a single AZ, you own patching).
- `nat_gateway`: fully managed and multi-AZ-capable, but bills ~per-hour continuously plus data,
  even when the workstation is stopped.

Either way egress is outbound-only; the workstation has no public IP and no inbound path.

## Auto-stop

`auto_stop_mode` defaults to `scheduled`: EventBridge Scheduler stops the workstation AND (when using
`nat_instance`) the NAT instance on a cron, so both cost and exposure go to zero when idle. `activity`
stops the workstation on sustained low CPU (use `scheduled` if you also want the NAT stopped). `none`
disables it.

## Initialize and validate (human runs apply, agents do not)

```bash
cp backend.hcl.example backend.hcl             # edit with bootstrap outputs
cp terraform.tfvars.example terraform.tfvars   # edit with real values
terraform -chdir=infra/stacks/workstation init -backend-config=backend.hcl
terraform -chdir=infra/stacks/workstation plan
```

Agents may run `fmt`, `validate`, and `plan` only. A human runs `apply`.
