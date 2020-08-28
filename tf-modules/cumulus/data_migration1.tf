module "data_migration1" {
  source = "../../lambdas/data-migration1"

  prefix = var.prefix

  permissions_boundary_arn = var.permissions_boundary_arn

  vpc_id            = var.vpc_id
  lambda_subnet_ids = var.lambda_subnet_ids

  dynamo_tables = var.dynamo_tables

  rds_user_access_secret_id = var.rds_user_access_secret_id

  tags = var.tags
}
