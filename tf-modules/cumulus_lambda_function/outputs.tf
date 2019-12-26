output "lambda_arn" {
  value = aws_lambda_function.task.arn
}

output "lambda_function_name" {
  value = aws_lambda_function.task.function_name
}

output "task_arn" {
  value = var.enable_versioning ? aws_lambda_function.task.qualified_arn : aws_lambda_function.task.arn
}

output "version_arn" {
  value = var.enable_versioning ? aws_lambda_function.task.qualified_arn : null
}
