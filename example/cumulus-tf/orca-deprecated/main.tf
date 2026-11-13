terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

variable "region" {
  type    = string
  default = null
}

provider "aws" {
  region = var.region
}
