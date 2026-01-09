output "lambda_function_arn" {
  description = "ARN of the Python reference task Lambda function"
  value       = aws_lambda_function.python_reference_task.arn
}

output "lambda_function_name" {
  description = "Name of the Python reference task Lambda function"
  value       = aws_lambda_function.python_reference_task.function_name
}

output "lambda_function_invoke_arn" {
  description = "Invoke ARN of the Python reference task Lambda function"
  value       = aws_lambda_function.python_reference_task.invoke_arn
}