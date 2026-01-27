output "lambda_function_arn" {
  description = "ARN of the Lambda function"
  value       = aws_lambda_function.granule_invalidator_task.arn
}

output "lambda_function_name" {
  description = "Name of the Lambda function"
  value       = aws_lambda_function.granule_invalidator_task.function_name
}

output "lambda_function_invoke_arn" {
  description = "Invoke ARN of the Lambda function"
  value       = aws_lambda_function.granule_invalidator_task.invoke_arn
}
