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

  ignore_tags {
    key_prefixes = ["gsfc-ngap"]
  }
}

locals {
  full_name = "${var.prefix}-replication"
}

resource "aws_db_subnet_group" "default" {
  name_prefix = var.aws_db_subnet_group_prefix
  subnet_ids  = var.subnets
  tags        = var.tags
}

resource "aws_ecs_cluster" "default" {
  name = "${var.prefix}-CumulusIcebergReplicationECSCluster"
  tags = var.tags
}

resource "aws_cloudwatch_log_group" "kafka-logs" {
  name              = "/aws/ecs/cluster/${local.full_name}/kafka"
  retention_in_days = 1
}

resource "aws_cloudwatch_log_group" "kafka-connect-logs" {
  name              = "/aws/ecs/cluster/${local.full_name}/kafka-connect"
  retention_in_days = 1
}

data "aws_iam_policy" "ECSInfrastructure" {
  arn = "arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRolePolicyForVolumes"
}



