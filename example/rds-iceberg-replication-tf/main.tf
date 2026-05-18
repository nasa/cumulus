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
  tags = merge(var.tags, { Deployment = var.prefix })
}

module "rds_iceberg_replication" {
  source                            = "../../tf-modules/rds-iceberg-replication"
  prefix                            = var.prefix
  admin_db_login_secret_arn         = var.admin_db_login_secret_arn
  region                            = var.region
  vpc_id                            = var.vpc_id
  subnet                            = var.subnet
  rds_security_group                = var.rds_security_group
  rds_endpoint                      = var.rds_endpoint
  force_new_deployment              = var.force_new_deployment
  small_tables_cpu                  = var.small_tables_cpu
  small_tables_memory               = var.small_tables_memory
  granules_table_cpu                = var.granules_table_cpu
  granules_table_memory             = var.granules_table_memory
  executions_table_cpu              = var.executions_table_cpu
  executions_table_memory           = var.executions_table_memory
  files_table_cpu                   = var.files_table_cpu
  files_table_memory                = var.files_table_memory
  snapshot_cleanup_cpu              = var.snapshot_cleanup_cpu
  snapshot_cleanup_memory           = var.snapshot_cleanup_memory
  cpu_architecture                  = var.cpu_architecture
  volume_size_in_gb                 = var.volume_size_in_gb
  kafka_image                       = var.kafka_image
  connect_image                     = var.connect_image
  bootstrap_image                   = var.bootstrap_image
  pg_db                             = var.pg_db
  iceberg_namespace                 = var.iceberg_namespace
  iceberg_s3_bucket                 = var.iceberg_s3_bucket
  compaction_interval_sec           = var.compaction_interval_sec
  iceberg_cleanup_image             = var.iceberg_cleanup_image
  snapshot_table_include_list       = var.snapshot_table_include_list
  snapshot_cleanup_interval_minutes = var.snapshot_cleanup_interval_minutes
  snapshot_older_than_minutes       = var.snapshot_older_than_minutes
  snapshot_retain_last              = var.snapshot_retain_last
  tags                              = merge(var.tags, { Deployment = var.prefix })
}
