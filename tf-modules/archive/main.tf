provider "aws" {
  version = ">= 2.21.0"
}

locals {
  default_tags = {
    Deployment = var.prefix
  }
}
