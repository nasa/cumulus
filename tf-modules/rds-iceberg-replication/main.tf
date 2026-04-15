terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.100, < 6.0.0"
    }
  }
}
provider "aws" {
  region = var.region

  ignore_tags {
    key_prefixes = ["gsfc-ngap"]
  }
}

locals {
  # full_name = "${var.prefix}-replication"
  replication_services = {
    small-tables = {
      slot_name          = "${var.prefix}-small-tables"
      table_include_list = "public.collections,public.async_operations,public.providers,public.pdrs,public.reconciliation_reports,public.rules"
    }
    executions = {
      slot_name          = "${var.prefix}-executions"
      table_include_list = "public.executions"
    }
    granules = {
      slot_name          = "${var.prefix}-granules"
      table_include_list = "public.granules"
    }
    files = {
      slot_name          = "${var.prefix}-files"
      table_include_list = "public.files"
    }
  }
}

module "cluster" {
  source            = "./modules/cluster"
  prefix            = var.prefix
  vpc_id            = var.vpc_id
  iceberg_s3_bucket = var.iceberg_s3_bucket
  tags              = var.tags
}

module "replication_services" {
  for_each = local.replication_services
  source   = "./modules/replication-service"

  slot_name          = each.value.slot_name
  table_include_list = each.value.table_include_list

  prefix                  = var.prefix
  vpc_id                  = var.vpc_id
  subnet                  = var.subnet
  rds_endpoint            = var.rds_endpoint
  rds_port                = var.rds_port
  iceberg_s3_bucket       = var.iceberg_s3_bucket
  iceberg_namespace       = var.iceberg_namespace
  kafka_image             = var.kafka_image
  connect_image           = var.connect_image
  bootstrap_image         = var.bootstrap_image
  cpu                     = var.cpu
  cpu_architecture        = var.cpu_architecture
  volume_size_in_gb       = var.volume_size_in_gb
  db_admin_password       = var.db_admin_password
  db_admin_username       = var.db_admin_username
  pg_db                   = var.pg_db
  ecs_infrastructure_role = module.cluster.ecs_infrastructure_role
  ecs_task_execution_role = module.cluster.task_execution_role
  fargate_task_role       = module.cluster.task_execution_role
  rds_security_group      = var.rds_security_group
  task_security_group_id  = module.cluster.no_ingress_all_egress_security_group.id
  ecs_cluster             = module.cluster.replication_ecs_cluster
}

# resource "aws_security_group" "no_ingress_all_egress" {

#   name   = "${var.prefix}-replication-ecs-no-ingress-all-egress"
#   vpc_id = var.vpc_id

#   egress {
#     from_port   = 0
#     to_port     = 0
#     protocol    = "-1"
#     cidr_blocks = ["0.0.0.0/0"]
#   }

#   lifecycle {
#     # This prevents the "In Use" error by creating a new one
#     # before trying to kill the old one during updates
#     create_before_destroy = true
#   }

#   tags = var.tags
# }

# resource "aws_ecs_cluster" "default" {
#   name = "${var.prefix}-CumulusIcebergReplicationECSCluster"
#   tags = var.tags
# }

# resource "aws_cloudwatch_log_group" "kafka-logs" {
#   name              = "/aws/ecs/cluster/${local.full_name}/kafka"
#   retention_in_days = 1
# }

# resource "aws_cloudwatch_log_group" "kafka-connect-logs" {
#   name              = "/aws/ecs/cluster/${local.full_name}/kafka-connect"
#   retention_in_days = 1
# }

# data "aws_iam_policy" "ECSInfrastructure" {
#   arn = "arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRolePolicyForVolumes"
# }
