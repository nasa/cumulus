terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.100, < 6.0.0"
    }
  }
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  default_tags {
    tags = {
      Deployment = var.prefix
    }
  }
}

data "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = local.admin_db_login_secret_arn
}

locals {
  tags                      = merge(var.tags, { Deployment = var.prefix })
  rds_security_group        = lookup(data.terraform_remote_state.data_persistence.outputs, "rds_security_group", "")
  rds_endpoint              = lookup(data.terraform_remote_state.rds_cluster.outputs, "rds_endpoint")
  admin_db_login_secret_arn = lookup(data.terraform_remote_state.rds_cluster.outputs, "admin_db_login_secret_arn")
  db_credentials            = jsondecode(data.aws_secretsmanager_secret_version.db_credentials.secret_string)
}

data "terraform_remote_state" "data_persistence" {
  backend   = "s3"
  config    = var.data_persistence_remote_state_config
  workspace = terraform.workspace
}

data "terraform_remote_state" "rds_cluster" {
  backend   = "s3"
  config    = var.rds_cluster_remote_state_config
  workspace = terraform.workspace
}

module "rds_iceberg_replication" {
  source               = "../../tf-modules/rds-iceberg-replication"
  prefix               = var.prefix
  db_admin_username    = local.db_credentials.username
  db_admin_password    = local.db_credentials.password
  region               = var.region
  vpc_id               = var.vpc_id
  subnet               = var.subnet
  rds_security_group   = local.rds_security_group
  rds_endpoint         = local.rds_endpoint
  force_new_deployment = var.force_new_deployment
  cpu                  = var.cpu
  cpu_architecture     = var.cpu_architecture
  volume_size_in_gb    = var.volume_size_in_gb
  kafka_image          = var.kafka_image
  connect_image        = var.connect_image
  bootstrap_image      = var.bootstrap_image
  pg_db                = "postgres"
  iceberg_namespace    = var.iceberg_namespace
  iceberg_s3_bucket    = var.iceberg_s3_bucket
  tags                 = merge(var.tags, { Deployment = var.prefix })
}
