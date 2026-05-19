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
  underscore_prefix = replace(var.prefix, "-", "_")
  replication_services = {
    small-tables = {
      slot_name           = "${local.underscore_prefix}_small_tables"
      table_include_list  = "${var.pg_schema}.collections,${var.pg_schema}.async_operations,${var.pg_schema}.providers,${var.pg_schema}.pdrs,${var.pg_schema}.reconciliation_reports,${var.pg_schema}.rules,${var.pg_schema}.granules_executions"
      column_exclude_list = ""
      memory              = var.small_tables_memory
      cpu                 = var.small_tables_cpu
      batch_size          = var.small_tables_batch_size
    }
    executions = {
      slot_name           = "${local.underscore_prefix}_executions"
      table_include_list  = "${var.pg_schema}.executions"
      column_exclude_list = "${var.pg_schema}.executions.original_payload,${var.pg_schema}.executions.final_payload"
      memory              = var.executions_table_memory
      cpu                 = var.executions_table_cpu
      batch_size          = var.executions_table_batch_size
    }
    granules = {
      slot_name           = "${local.underscore_prefix}_granules"
      table_include_list  = "${var.pg_schema}.granules"
      column_exclude_list = ""
      memory              = var.granules_table_memory
      cpu                 = var.granules_table_cpu
      batch_size          = var.granules_table_batch_size
    }
    files = {
      slot_name           = "${local.underscore_prefix}_files"
      table_include_list  = "${var.pg_schema}.files"
      column_exclude_list = ""
      memory              = var.files_table_memory
      cpu                 = var.files_table_cpu
      batch_size          = var.files_table_batch_size
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

  slot_name           = each.value.slot_name
  table_include_list  = each.value.table_include_list
  column_exclude_list = each.value.column_exclude_list

  prefix                    = var.prefix
  vpc_id                    = var.vpc_id
  subnet                    = var.subnet
  rds_endpoint              = var.rds_endpoint
  rds_port                  = var.rds_port
  iceberg_s3_bucket         = var.iceberg_s3_bucket
  iceberg_namespace         = var.iceberg_namespace
  kafka_image               = var.kafka_image
  connect_image             = var.connect_image
  bootstrap_image           = var.bootstrap_image
  memory                    = each.value.memory
  cpu                       = each.value.cpu
  cpu_architecture          = var.cpu_architecture
  batch_size                = each.value.batch_size
  volume_size_in_gb         = var.volume_size_in_gb
  admin_db_login_secret_arn = var.admin_db_login_secret_arn
  pg_db                     = var.pg_db
  ecs_infrastructure_role   = module.cluster.ecs_infrastructure_role
  ecs_task_execution_role   = module.cluster.task_execution_role
  fargate_task_role         = module.cluster.fargate_task_role
  rds_security_group        = var.rds_security_group
  task_security_group_id    = module.cluster.no_ingress_all_egress_security_group.id
  ecs_cluster               = module.cluster.replication_ecs_cluster
  compaction_interval_sec   = var.compaction_interval_sec
}
