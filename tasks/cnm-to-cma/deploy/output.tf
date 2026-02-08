output "lambda_function_arn" {
  description = "ARN of the Lambda function"
  value = aws_lambda_function.cnm_to_cma.arn
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
