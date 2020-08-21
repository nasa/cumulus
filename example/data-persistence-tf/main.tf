terraform {
  required_providers {
    aws = ">= 2.31.0"
  }
}

provider "aws" {
  region = var.aws_region
}

module "data_persistence" {
  source = "../../tf-modules/data-persistence"
  prefix                      = var.prefix
  subnet_ids                  = var.subnet_ids
  enable_point_in_time_tables = var.enable_point_in_time_tables

  elasticsearch_config = var.elasticsearch_config

  tags = merge(var.tags, { Deployment = var.prefix })
}
