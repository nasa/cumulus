output "security_group_id" {
  value = aws_security_group.rds_cluster_access.id
}

output "rds_endpoint" {
  value = aws_rds_cluster.core_team_cluster.endpoint
}

output "secret_id" {
  value = aws_secretsmanager_secret_version.rds_login.id
}

output "secret_version" {
  value = aws_secretsmanager_secret_version.rds_login.version_id
}

