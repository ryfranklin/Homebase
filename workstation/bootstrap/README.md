# workstation/bootstrap

Cloud-init user-data for the EC2 workstation (rendered by the `workstation` Terraform stack).

`user-data.sh.tftpl` installs the dev toolchain (git, docker, node, python, aws cli), mounts the
persistent encrypted home volume at `/workspace`, and installs a login hook that:

- clones your dotfiles from the repo URL published in SSM (`.../workstation/dotfiles_repo_url`), and
- materializes your machine-local shell secret (the `~/.zshrc.local` pattern) from Secrets Manager at
  session start, using the instance role.

Guarantees:

- No real repo URL, account, or secret is in this file. The dotfiles URL and secret name are inputs
  (Terraform variables) surfaced via SSM; the secret value is fetched at login, never baked into the
  AMI or committed.
- No long-lived key is ever written to disk. Credentials come from the instance role and short-lived
  role assumption only.

Templating note: only `${aws_region}`, `${project_name}`, `${environment}`, `${workstation_user}`,
and `${home_device}` are Terraform values; every shell variable uses `$VAR` (no braces) so it passes
through `templatefile()` untouched.
