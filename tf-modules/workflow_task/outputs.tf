output "alias_arn" {
  value = var.enable_versioning ? aws_lambda_alias.default[0].arn : null
}

output "lambda_arn" {
  value = aws_lambda_function.task.arn
}

output "lambda_function_name" {
  value = aws_lambda_function.task.function_name
}

output "task_arn" {
  value = var.enable_versioning ? aws_lambda_alias.default[0].arn : aws_lambda_function.task.arn
}

output "version_arn" {
  value = var.enable_versioning ? aws_lambda_function.task.version : null
}
