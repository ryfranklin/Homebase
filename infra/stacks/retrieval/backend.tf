terraform {
  # Remote state in the S3 bucket and DynamoDB lock table created by the
  # bootstrap stack. Partial configuration: concrete values come from a
  # git-ignored backend.hcl (see backend.hcl.example). Initialize with:
  #
  #   terraform -chdir=infra/stacks/retrieval init -backend-config=backend.hcl
  #
  backend "s3" {}
}
