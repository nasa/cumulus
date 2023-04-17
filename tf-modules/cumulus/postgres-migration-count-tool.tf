module "postgres_migration_count_tool" {
  source = "../../lambdas/postgres-migration-count-tool"
  buckets                                = var.buckets
  dynamo_tables                          = var.dynamo_tables
  lambda_subnet_ids                      = var.lambda_subnet_ids
  permissions_boundary_arn               = var.permissions_boundary_arn
  prefix                                 = var.prefix
  rds_connection_timing_configuration    = var.rds_connection_timing_configuration
  rds_security_group_id                  = var.rds_security_group
  rds_user_access_secret_arn             = var.rds_user_access_secret_arn
  system_bucket                          = var.system_bucket
  tags                                   = var.tags
  vpc_id                                 = var.vpc_id
  default_log_retention_days = var.default_log_retention_days
  cloudwatch_log_retention_periods = var.cloudwatch_log_retention_periods
}
