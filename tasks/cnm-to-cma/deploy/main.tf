terraform {
  required_providers {
    aws  = ">= 2.31.0"
    null = "~> 2.1"
  }
}

provider "aws" {
  region  = var.region

  ignore_tags {
    key_prefixes = ["gsfc-ngap"]
  }
}

data "aws_caller_identity" "current" {}

locals {
  name = var.app_name
  environment = var.prefix

  tags = length(var.default_tags) == 0 ? {
    team: "Cumulus Coreification Engineering",
    application: var.app_name,
  } : var.default_tags

  lambda_resources_name = terraform.workspace == "default" ? "svc-${local.name}-${local.environment}" : "svc-${local.name}-${local.environment}-${terraform.workspace}"
}
