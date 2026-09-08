output "cumulus_task_lambda" {
  description = "The task lambda function"
  value       = module.cnm_response_task.cumulus_task_lambda
}

output "cumulus_task_log_group_name" {
  description = "The task lambda function log group"
  value       = module.cnm_response_task.cumulus_task_log_group_name
}
