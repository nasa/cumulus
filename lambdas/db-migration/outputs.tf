output "db_migration_result" {
  value = data.aws_lambda_invocation.db_migration.result
}
