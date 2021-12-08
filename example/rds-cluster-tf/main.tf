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

data "aws_vpc" "application_vpc" {
  count = var.vpc_id == null ? 1 : 0
  tags = {
    Name = var.vpc_tag_name
  }
}

data "aws_subnet_ids" "subnet_ids" {
  count = var.subnets == null ? 1 : 0
  vpc_id = var.vpc_id != null ? var.vpc_id : data.aws_vpc.application_vpc[0].id

  filter {
    name   = "tag:Name"
    values = [var.subnets_tag_name]
  }
}

module "rds_cluster" {
  source              = "../../tf-modules/cumulus-rds-tf"
  prefix              = var.prefix
  db_admin_username   = var.db_admin_username
  db_admin_password   = var.db_admin_password
  region              = var.region
  vpc_id              = var.vpc_id != null ? var.vpc_id : data.aws_vpc.application_vpc[0].id
  subnets             = var.subnets != null ? var.subnets : data.aws_subnet_ids.subnet_ids[0].ids
  engine_version      = var.engine_version
  deletion_protection = true
  cluster_identifier  = var.cluster_identifier
  tags                = var.tags
  snapshot_identifier = var.snapshot_identifier
}
