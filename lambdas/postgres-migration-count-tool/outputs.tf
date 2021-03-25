output "postgres_migration_count_tool_function_arn" {
  value = aws_lambda_function.postgres_migration_count_tool.arn
}

output "postgres_migration_count_tool_role" {
  value = aws_iam_role.postgres_migration_count_role.arn
}
