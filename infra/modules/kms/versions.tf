terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # Spans 5.x and 6.x: this module is consumed by both the 5.x stacks
      # (bootstrap, storage) and the 6.x agent stack. Its resources are stable
      # across the two majors. Each root stack still pins its own major.
      version = ">= 5.60.0, < 7.0.0"
    }
  }
}
