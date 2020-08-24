terraform {
  required_providers {
    aws = ">= 2.31.0"
  }
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile
}

module "rds_cluster" {
  source      = "../../tf-modules/cumulus-rds-tf"
  profile     = var.profile
  db_username = var.db_username
  db_password = var.db_password
  region      = var.region
  vpc_id      = var.vpc_id
  subnets     = var.subnets
  deletion_protection = true
  cluster_identifier = "cumulus-dev-rds-cluster"
}
