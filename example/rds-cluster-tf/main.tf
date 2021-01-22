terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 3.14.1"
    }
  }
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile
}

module "rds_cluster" {
  source      = "../../tf-modules/cumulus-rds-tf"
  db_admin_username    = var.db_admin_username
  db_admin_password    = var.db_admin_password
  region               = var.region
  vpc_id               = var.vpc_id
  subnets              = var.subnets
  engine_version       = var.engine_version
  deletion_protection  = true
  cluster_identifier   = var.cluster_identifier
  tags                 = var.tags
  snapshot_identifier  = var.snapshot_identifier
}
