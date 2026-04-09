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

resource "aws_security_group" "no_ingress_all_egress" {

  name   = "${var.prefix}-replication-ecs-no-ingress-all-egress"
  vpc_id = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle {
    # This prevents the "In Use" error by creating a new one
    # before trying to kill the old one during updates
    create_before_destroy = true
  }

  tags = var.tags
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
