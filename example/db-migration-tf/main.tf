terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 3.5.0"
    }
  }
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  ignore_tags {
    key_prefixes = ["gsfc-ngap"]
  }
}

locals {
  rds_security_group         = lookup(data.terraform_remote_state.data_persistence.outputs, "rds_security_group", var.rds_security_group)
  rds_credentials_secret_arn = lookup(data.terraform_remote_state.data_persistence.outputs, "database_credentials_secret_arn", var.rds_user_access_secret_arn)
}

data "terraform_remote_state" "data_persistence" {
  backend   = "s3"
  config    = var.data_persistence_remote_state_config
  workspace = terraform.workspace
}

module "db_migration" {
  source = "../../lambdas/db-migration"

  rds_user_access_secret_arn = local.rds_credentials_secret_arn
  permissions_boundary_arn   = var.permissions_boundary_arn
  prefix                     = var.prefix
  subnet_ids                 = var.subnet_ids
  tags                       = merge(var.tags, { Deployment = var.prefix })
  vpc_id                     = var.vpc_id
  rds_security_group_id      = local.rds_security_group
}
