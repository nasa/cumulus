module "reconciliation_report_migration_lambda" {
  source = "../../lambdas/reconciliation-report-migration"

  prefix              = var.prefix
  system_bucket       = var.system_bucket

  dynamo_tables = var.dynamo_tables

  lambda_subnet_ids   = var.lambda_subnet_ids
  lambda_timeouts     = var.lambda_timeouts
  lambda_memory_sizes = var.lambda_memory_sizes

  permissions_boundary_arn   = var.permissions_boundary_arn

  rds_security_group_id                  = var.rds_security_group
  rds_user_access_secret_arn             = var.rds_user_access_secret_arn

  tags                = var.tags
  vpc_id              = var.vpc_id
}

