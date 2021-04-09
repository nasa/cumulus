module "db_migration" {
  source = "../../lambdas/db-migration"
  rds_user_access_secret_arn = var.rds_user_access_secret_arn
  permissions_boundary_arn   = var.permissions_boundary_arn
  prefix                     = var.prefix
  subnet_ids                 = var.subnet_ids
  tags                       = merge(var.tags, { Deployment = var.prefix })
  vpc_id                     = var.vpc_id
  rds_security_group_id      = var.rds_security_group_id
}
