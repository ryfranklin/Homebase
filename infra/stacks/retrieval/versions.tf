terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # S3 Vectors storage configuration for aws_bedrockagent_knowledge_base,
      # and the aws_s3vectors_* resources, require provider >= 6.27.0.
      # (Other stacks pin 5.x; this stack intentionally needs 6.x.)
      version = ">= 6.27.0, < 7.0.0"
    }
  }
}
