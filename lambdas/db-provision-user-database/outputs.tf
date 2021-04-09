output "database_credentials_secret_arn" {
  value = aws_secretsmanager_secret.db_credentials.arn
}
output "user_database_provision" {
  value = jsondecode(data.aws_lambda_invocation.provision_database.result)
}
