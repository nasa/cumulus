terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.100"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.1.0"
    }
  }
}
