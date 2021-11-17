# ORCA Module
module "orca" {
  count                          = var.include_orca ? 1 : 0
  source = "https://github.com/nasa/cumulus-orca/releases/download/v3.0.2/cumulus-orca-terraform.zip"
  ## --------------------------
  ## Cumulus Variables
  ## --------------------------
  ## REQUIRED
  buckets                  = var.buckets
  lambda_subnet_ids        = var.lambda_subnet_ids
  permissions_boundary_arn = var.permissions_boundary_arn
  prefix                   = var.prefix
  system_bucket            = var.system_bucket
  vpc_id                   = var.vpc_id
  workflow_config          = module.cumulus.workflow_config

  ## OPTIONAL
  tags        = var.tags

  ## --------------------------
  ## ORCA Variables
  ## --------------------------
  ## REQUIRED
  database_app_user_pw = var.orca_database_app_user_pw
  orca_default_bucket  = var.orca_default_bucket
  postgres_user_pw     = var.orca_postgres_user_pw

  ## OPTIONAL
  database_port                                = 5432
  default_multipart_chunksize_mb               = var.default_s3_multipart_chunksize_mb
  orca_ingest_lambda_memory_size               = 2240
  orca_ingest_lambda_timeout                   = 600
  orca_recovery_buckets                        = []
  orca_recovery_complete_filter_prefix         = ""
  orca_recovery_expiration_days                = 5
  orca_recovery_lambda_memory_size             = 128
  orca_recovery_lambda_timeout                 = 720
  orca_recovery_retry_limit                    = 3
  orca_recovery_retry_interval                 = 1
  orca_recovery_retry_backoff                  = 2
  sqs_delay_time_seconds                       = 0
  sqs_maximum_message_size                     = 262144
  staged_recovery_queue_message_retention_time_seconds = 432000
  status_update_queue_message_retention_time_seconds   = 777600
}
