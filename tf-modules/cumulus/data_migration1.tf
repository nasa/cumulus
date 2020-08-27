module "data_migration1" {
  source = "../../lambdas/data-migration1"

  prefix = var.prefix

  permissions_boundary_arn = var.permissions_boundary_arn

  vpc_id            = var.vpc_id
  lambda_subnet_ids = var.lambda_subnet_ids

  dynamo_tables = var.dynamo_tables

  pg_host     = var.pg_host
  pg_password = var.pg_password
  pg_user     = var.pg_user
  pg_database = var.pg_database

  tags = var.tags
}
