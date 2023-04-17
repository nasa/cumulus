module "data_migration2" {
  source = "../../lambdas/data-migration2"

  prefix = var.prefix

  permissions_boundary_arn = var.permissions_boundary_arn

  vpc_id            = var.vpc_id
  lambda_subnet_ids = var.lambda_subnet_ids

  dynamo_tables = var.dynamo_tables

  rds_security_group_id               = var.rds_security_group
  rds_user_access_secret_arn          = var.rds_user_access_secret_arn
  rds_connection_timing_configuration = var.rds_connection_timing_configuration

  system_bucket = var.system_bucket

  tags = var.tags
  
  default_log_retention_days = var.default_log_retention_days
  cloudwatch_log_retention_periods = var.cloudwatch_log_retention_periods
}
