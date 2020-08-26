output "database_credentials_secret_arn" {
  value = aws_secretsmanager_secret.db_credentials.arn
}
