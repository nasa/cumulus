output "db_migration" {
  value = data.aws_lambda_invocation.db_migration.result
}
