# ORCA Module
module "orca" {
  count                          = var.include_orca ? 1 : 0
  source                         = "https://github.com/nasa/cumulus-orca/releases/download/v2.0.1/cumulus-orca-terraform.zip//modules/orca"
  vpc_id                         = var.vpc_id
  subnet_ids                     = var.lambda_subnet_ids
  workflow_config                = module.cumulus.workflow_config
  region                         = var.region
  prefix                         = var.prefix
  permissions_boundary_arn       = var.permissions_boundary_arn
  buckets                        = var.buckets
  platform                       = var.platform
  database_name                  = var.database_name
  database_port                  = var.database_port
  postgres_user_pw               = var.postgres_user_pw
  database_app_user              = var.database_app_user
  database_app_user_pw           = var.database_app_user_pw
  drop_database                  = var.drop_database
  ddl_dir                        = var.ddl_dir
  lambda_timeout                 = var.lambda_timeout
  restore_complete_filter_prefix = var.restore_complete_filter_prefix
  copy_retry_sleep_secs          = var.copy_retry_sleep_secs
  default_tags                   = var.default_tags
}
