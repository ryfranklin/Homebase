terraform {
  # Remote state in the bootstrap S3 bucket and lock table. Partial config from a
  # git-ignored backend.hcl (see backend.hcl.example). Initialize with:
  #
  #   terraform -chdir=infra/stacks/ssh-chat init -backend-config=backend.hcl
  #
  backend "s3" {}
}
