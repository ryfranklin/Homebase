terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # AgentCore resources (aws_bedrockagentcore_*) require a recent 6.x provider.
      version = ">= 6.27.0, < 7.0.0"
    }
  }
}
