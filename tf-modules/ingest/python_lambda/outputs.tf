output "lambda_function" {
  description = "The task lambda function"
  value       = aws_lambda_function.python_task
}

output "lambda_log_group_name" {
  description = "Name of the CloudWatch log group for the Lambda function"
  value       = aws_cloudwatch_log_group.python_task.name
}
