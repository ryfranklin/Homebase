terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60.0, < 6.0.0"
    }
  }

  # LOCAL state by design. This is the ONLY stack that uses local state, because
  # it creates the very S3 bucket and DynamoDB table that every other stack uses
  # as its remote backend. Do NOT add a backend "s3" block here. See README.md.
  # The resulting terraform.tfstate is git-ignored.
}
