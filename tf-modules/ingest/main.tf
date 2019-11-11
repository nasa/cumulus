provider "aws" {
  version = "~> 2.31"
}

locals {
  default_tags = { Deployment = var.prefix }
}
