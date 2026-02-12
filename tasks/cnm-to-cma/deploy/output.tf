output "lambda_function" {
  description = "The task lambda function"
  value       = aws_lambda_function.cnm_to_cma
}

output "lambda_function_name" {
  description = "Name of the Lambda function"
  value = aws_lambda_function.cnm_to_cma.function_name
}

output "lambda_function_invoke_arn" {
  description = "Invoke ARN of the Lambda function"
  value       = aws_lambda_function.cnm_to_cma.invoke_arn
}

output "lambda_function_last_modified" {
  description = "Last modified date of the Lambda function"
  value       = aws_lambda_function.cnm_to_cma.last_modified
}
output "lambda_log_group_name" {
  description = "Name of the Lambda's CloudWatch log group"
  value       = aws_cloudwatch_log_group.cnm_to_cma.name
}
