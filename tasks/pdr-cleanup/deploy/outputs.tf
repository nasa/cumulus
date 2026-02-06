output "pdr_cleanup_task_arn" {
  description = "ARN of the PDR Cleanup task Lambda function"
  value       = aws_lambda_function.pdr_cleanup_task.arn
}

output "pdr_cleanup_task_name" {
  description = "Name of the PDR Cleanup task Lambda function"
  value       = aws_lambda_function.pdr_cleanup_task.function_name
}

output "pdr_cleanup_task_invoke_arn" {
  description = "Invoke ARN of the PDR Cleanup task Lambda function"
  value       = aws_lambda_function.pdr_cleanup_task.invoke_arn
}
