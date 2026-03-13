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

locals {
  tags                            = merge(var.tags, { Deployment = var.prefix })
  rds_security_group              = lookup(data.terraform_remote_state.data_persistence.outputs, "rds_security_group", "")
  rds_endpoint                    = lookup(data.terraform_remote_state.rds_cluster.outputs, "rds_endpoint")
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

module "ecs_cluster" {
  source                     = "../../tf-modules/rds-iceberg-replication-tf"
  prefix                     = var.prefix
  db_admin_username          = var.db_admin_username
  db_admin_password          = var.db_admin_password
  region                     = var.region
  vpc_id                     = var.vpc_id
  subnets                    = var.subnets
  rds_security_group         = local.rds_security_group
  rds_endpoint               = local.rds_endpoint
  force_new_deployment       = var.force_new_deployment
  cpu                        = var.cpu
  cpu_architecture           = var.cpu_architecture
  volume_size_in_gb          = var.volume_size_in_gb
  kafka_image                = var.kafka_image
  connect_image              = var.connect_image
  tags                       = merge(var.tags, { Deployment = var.prefix })
}
