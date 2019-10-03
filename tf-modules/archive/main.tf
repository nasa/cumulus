provider "aws" {
  version = ">= 2.21.0"
  region = var.region
}

locals {
  default_tags = {
    Deployment = var.prefix
  }
}
