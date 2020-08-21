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

  rds_access_secret_id     = var.rds_access_secret_id
  permissions_boundary_arn = var.permissions_boundary_arn
  prefix                   = var.prefix
  subnet_ids               = var.subnet_ids
  tags                     = merge(var.tags, { Deployment = var.prefix })
  vpc_id                   = var.vpc_id
  rds_security_group_id    = var.rds_security_group_id

}
