output "pdr_cleanup_lambda_function" {
  description = "The task lambda function"
  value       = aws_lambda_function.pdr_cleanup_task
}

output "pdr_cleanup_log_group" {
  description = "The task lambda function log group"
  value       = aws_cloudwatch_log_group.pdr_cleanup_task
}
