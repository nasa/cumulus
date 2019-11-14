terraform {
  required_providers {
    aws = ">= 2.31.0"
  }
}

locals {
  default_tags = { Deployment = var.prefix }
}
