output "security_group_id" {
  value = aws_security_group.rds_cluster_access.id
}

output "rds_endpoint" {
  value = aws_rds_cluster.cumulus.endpoint
}

output "admin_db_login_secret_arn" {
  value = aws_secretsmanager_secret_version.rds_login.arn
}

output "admin_db_login_secret_version" {
  value = aws_secretsmanager_secret_version.rds_login.version_id
}

output "user_credentials_secret_arn" {
  value = length(aws_secretsmanager_secret.db_credentials) > 0 ? aws_secretsmanager_secret.db_credentials[0].arn : ""
}

