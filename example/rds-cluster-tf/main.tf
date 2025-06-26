terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.100"
    }
  }
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile
}

module "rds_cluster" {
  source                     = "../../tf-modules/cumulus-rds-tf"
  prefix                     = var.prefix
  db_admin_username          = var.db_admin_username
  db_admin_password          = var.db_admin_password
  region                     = var.region
  vpc_id                     = var.vpc_id != null ? var.vpc_id : data.aws_vpc.application_vpc[0].id
  subnets                    = var.subnets != null ? var.subnets : data.aws_subnets.subnet_ids[0].ids
  engine_version             = var.engine_version
  deletion_protection        = true
  cluster_identifier         = var.cluster_identifier
  cluster_instance_count     = var.cluster_instance_count
  tags                       = var.tags
  snapshot_identifier        = var.snapshot_identifier
  lambda_timeouts            = var.lambda_timeouts
  lambda_memory_sizes        = var.lambda_memory_sizes
  parameter_group_family_v13 = var.parameter_group_family_v13
}
