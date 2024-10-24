output "security_group_id" {
  value = aws_security_group.rds_cluster_access.id
}

output "rds_endpoint" {
  value = aws_rds_cluster.cumulus.endpoint
}

output "rds_reader_endpoint" {
  value = aws_rds_cluster.cumulus.reader_endpoint
}

output "admin_db_login_secret_arn" {
  value = aws_secretsmanager_secret_version.rds_login.arn
}

output "admin_db_login_secret_version" {
  value = aws_secretsmanager_secret_version.rds_login.version_id
}

output "user_credentials_secret_arn" {
  value = var.provision_user_database ? module.provision_database[0].database_credentials_secret_arn : null
}
