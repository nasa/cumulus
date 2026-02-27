output "lambda_function" {
  description = "The task lambda function"
  value       = aws_lambda_function.cnm_to_cma
}

output "log_group" {
  description = "The task lambda function log group"
  value       = aws_cloudwatch_log_group.cnm_to_cma
}
