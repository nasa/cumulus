terraform {
  required_providers {
    aws = ">= 2.31.0"
  }
}

provider "aws" {
  region = var.aws_region
}

module "provision_database" {
  source                   = "../../lambdas/db-provision-user-database"
  prefix                   = var.prefix
  subnet_ids               = var.subnet_ids
  db_security_groups       = var.db_security_groups
  rds_access_secret_id     = var.rds_access_secret_id
  tags                     = var.tags
  permissions_boundary_arn = var.permissions_boundary_arn
  vpc_id                   = var.vpc_id
  rds_user_password        = var.rds_user_password
}

module "data_persistence" {
  source = "../../tf-modules/data-persistence"
  prefix                      = var.prefix
  subnet_ids                  = var.subnet_ids
  enable_point_in_time_tables = var.enable_point_in_time_tables

  elasticsearch_config = var.elasticsearch_config

  tags = merge(var.tags, { Deployment = var.prefix })
}
