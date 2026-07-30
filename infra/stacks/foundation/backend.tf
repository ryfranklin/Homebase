terraform {
  # Remote state lives in the S3 bucket and DynamoDB lock table created by the
  # bootstrap stack. This is a PARTIAL backend configuration on purpose: the
  # concrete bucket, key, region, dynamodb_table, and kms_key_id are supplied
  # from a git-ignored backend.hcl (see backend.hcl.example), so no account
  # specifics are committed. Initialize with:
  #
  #   terraform -chdir=infra/stacks/foundation init -backend-config=backend.hcl
  #
  backend "s3" {}
}
