terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.1.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  ignore_tags {
    key_prefixes = ["gsfc-ngap"]
  }
}

resource "random_string" "db_pass" {
  length  = 50
  upper   = true
  special = false
}

module "provision_database" {
  source                                 = "../../lambdas/db-provision-user-database"
  vpc_id                                 = var.vpc_id != null ? var.vpc_id : data.aws_vpc.application_vpc[0].id
  subnet_ids                             = var.subnet_ids != null ? var.subnet_ids : data.aws_subnets.subnet_ids[0].ids
  prefix                                 = var.prefix
  rds_security_group                     = var.rds_security_group
  rds_admin_access_secret_arn            = var.rds_admin_access_secret_arn
  tags                                   = var.tags
  permissions_boundary_arn               = var.permissions_boundary_arn
  rds_user_password                      = var.rds_user_password == "" ? random_string.db_pass.result : var.rds_user_password
  rds_connection_timing_configuration    = var.rds_connection_timing_configuration
  dbRecreation                           = false
  lambda_timeouts                        = var.lambda_timeouts
  lambda_memory_sizes                    = var.lambda_memory_sizes
}

module "data_persistence" {
  depends_on                     = [module.provision_database.user_database_provision]
  source                         = "../../tf-modules/data-persistence"
  prefix                         = var.prefix
  vpc_id                         = var.vpc_id != null ? var.vpc_id : data.aws_vpc.application_vpc[0].id
  subnet_ids                     = var.subnet_ids != null ? var.subnet_ids : data.aws_subnets.subnet_ids[0].ids
  enable_point_in_time_tables    = var.enable_point_in_time_tables

  elasticsearch_config           = var.elasticsearch_config

  rds_security_group_id          = var.rds_security_group
  rds_user_access_secret_arn     = module.provision_database.database_credentials_secret_arn
  permissions_boundary_arn       = var.permissions_boundary_arn
  tags                           = merge(var.tags, { Deployment = var.prefix })
  lambda_timeouts                = var.lambda_timeouts
  lambda_memory_sizes            = var.lambda_memory_sizes
}
