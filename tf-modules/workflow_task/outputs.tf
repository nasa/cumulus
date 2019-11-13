output "alias_arn" {
  value = var.enable_versioning ? "${aws_lambda_function.task.arn}:${aws_lambda_function.task.function_name}-${local.package_md5}" : null
}

output "lambda_arn" {
  value = aws_lambda_function.task.arn
}

output "lambda_function_name" {
  value = aws_lambda_function.task.function_name
}

output "task_arn" {
  value = var.enable_versioning ? "${aws_lambda_function.task.arn}:${aws_lambda_function.task.function_name}-${local.package_md5}" : aws_lambda_function.task.arn
}

output "version_arn" {
  value = var.enable_versioning ? aws_lambda_function.task.version : null
}
