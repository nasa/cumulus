output "cumulus_task_lambda" {
  description = "The task lambda function"
  value       = module.aws_api_proxy.cumulus_task_lambda
}

output "cumulus_task_log_group_name" {
  description = "Name of the CloudWatch log group for the Lambda function"
  value       = module.aws_api_proxy.cumulus_task_log_group_name
}
