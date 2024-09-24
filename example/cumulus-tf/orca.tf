data "aws_secretsmanager_secret" "rds_admin_credentials" {
  arn = var.rds_admin_access_secret_arn
}

data "aws_secretsmanager_secret_version" "rds_admin_credentials" {
  secret_id = data.aws_secretsmanager_secret.rds_admin_credentials.id
}

locals {
  rds_admin_login = jsondecode(data.aws_secretsmanager_secret_version.rds_admin_credentials.secret_string)
}

# ORCA Module
module "orca" {
  aws_region = var.region
  source = "https://github.com/paulpilone/cumulus-orca/archive/refs/tags/v10.0.0-beta2.zip"

  ## --------------------------
  ## Cumulus Variables
  ## --------------------------
  ## REQUIRED
  buckets                  = var.buckets
  lambda_subnet_ids        = local.subnet_ids
  permissions_boundary_arn = var.permissions_boundary_arn
  prefix                   = var.prefix
  system_bucket            = var.system_bucket
  vpc_id                   = local.vpc_id

  ## OPTIONAL
  tags                     = var.tags

  ## --------------------------
  ## ORCA Variables
  ## --------------------------
  ## REQUIRED
  db_admin_password    = local.rds_admin_login.password
  db_host_endpoint     = local.rds_admin_login.host
  db_user_password     = var.orca_db_user_password
  dlq_subscription_email   = var.orca_dlq_subscription_email
  orca_default_bucket  = var.orca_default_bucket
  orca_reports_bucket_name = var.system_bucket
  rds_security_group_id    = local.rds_security_group
  # s3_access_key        = var.orca_s3_access_key
  # s3_secret_key        = var.orca_s3_secret_key
  db_cluster_identifier = local.rds_admin_login.dbClusterIdentifier

  ## OPTIONAL
  db_admin_username                                    = local.rds_admin_login.username
  default_multipart_chunksize_mb                       = var.default_s3_multipart_chunksize_mb
  orca_ingest_lambda_memory_size                       = 2240
  orca_ingest_lambda_timeout                           = 720
  orca_recovery_buckets                                = []
  orca_recovery_complete_filter_prefix                 = ""
  orca_recovery_expiration_days                        = 5
  orca_recovery_lambda_memory_size                     = 128
  orca_recovery_lambda_timeout                         = 720
  orca_recovery_retry_limit                            = 3
  orca_recovery_retry_interval                         = 1
  orca_recovery_retry_backoff                          = 2
  sqs_delay_time_seconds                               = 0
  sqs_maximum_message_size                             = 262144
  staged_recovery_queue_message_retention_time_seconds = 432000
  status_update_queue_message_retention_time_seconds   = 777600
  vpc_endpoint_id                                      = null
}
