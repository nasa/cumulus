output "cumulus_task_lambda" {
  description = "The task lambda function"
  value       = aws_lambda_function.cumulus_task_lambda
}

output "cumulus_task_log_group_name" {
  description = "The task lambda function log group"
  value       = aws_cloudwatch_log_group.cumulus_task_log_group.name
}
