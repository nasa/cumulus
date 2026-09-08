output "cumulus_task_lambda" {
  description = "The task lambda function"
  value       = module.get_cnm_task.cumulus_task_lambda
}

output "cumulus_task_log_group_name" {
  description = "The task lambda function log group"
  value       = module.get_cnm_task.cumulus_task_log_group_name
}
