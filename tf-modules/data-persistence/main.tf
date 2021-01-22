terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 3.0,!= 3.14.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 2.3"
    }
  }
}
