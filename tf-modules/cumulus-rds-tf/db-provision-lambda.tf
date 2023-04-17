resource "random_string" "db_pass" {
  length  = 50
  upper   = true
  special = false
}

module "provision_database" {
  count = var.provision_user_database ? 1 : 0
  permissions_boundary_arn               = var.permissions_boundary_arn
  prefix                                 = var.prefix
  rds_admin_access_secret_arn            = aws_secretsmanager_secret_version.rds_login.arn
  rds_connection_timing_configuration    = var.rds_connection_timing_configuration
  rds_security_group                     = aws_security_group.rds_cluster_access.id
  rds_user_password                      = var.rds_user_password == "" ? random_string.db_pass.result : var.rds_user_password
  source                                 = "./db-provision-user-database"
  subnet_ids                             = var.subnets
  tags                                   = var.tags
  vpc_id                                 = var.vpc_id

  default_log_retention_days             = var.default_log_retention_days
  cloudwatch_log_retention_periods       = var.cloudwatch_log_retention_periods
}
