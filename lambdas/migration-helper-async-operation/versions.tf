terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      version = ">= 5.100, < 6.0.0"
    }
  }
  required_version = ">= 1.12"
}
