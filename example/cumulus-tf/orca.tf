data "aws_secretsmanager_secret" "rds_admin_credentials" {
  arn = var.rds_admin_access_secret_arn
}

data "aws_secretsmanager_secret_version" "rds_admin_credentials" {
  secret_id = data.aws_secretsmanager_secret.rds_admin_credentials.id
}

locals {
  rds_admin_login = jsondecode(data.aws_secretsmanager_secret_version.rds_admin_credentials.secret_string)
}
