terraform {
  required_providers {
    aws = ">= 2.31.0"
  }
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile
}

module "db_migration" {
  source = "../../lambdas/db-migration"

  permissions_boundary_arn = var.permissions_boundary_arn
  pg_host                  = var.pg_host
  pg_password              = var.pg_password
  pg_user                  = var.pg_user
  pg_database              = var.pg_database
  prefix                   = var.prefix
  subnet_ids               = var.subnet_ids
  tags                     = merge(var.tags, { Deployment = var.prefix })
  vpc_id                   = var.vpc_id
}
