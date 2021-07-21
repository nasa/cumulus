resource "random_string" "db_pass" {
  length  = 50
  upper   = true
  special = false
}

module "provision_database" {
  count = var.provision_user_database ? 1 : 0
  source                      = "./db-provision-user-database"
  prefix                      = var.prefix
  subnet_ids                  = var.subnets
  rds_security_group          = aws_security_group.rds_cluster_access.id
  rds_admin_access_secret_arn = aws_secretsmanager_secret_version.rds_login.arn
  tags                        = var.tags
  permissions_boundary_arn    = var.permissions_boundary_arn
  vpc_id                      = var.vpc_id
  rds_user_password           = var.rds_user_password == "" ? random_string.db_pass.result : var.rds_user_password
  rds_connection_heartbeat    = true
}
