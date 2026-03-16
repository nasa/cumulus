output "add_input_granules_lambda" {
  description = "The task lambda function"
  value       = module.add_input_granules_task.cumulus_task_lambda
}

output "add_input_granules_log_group" {
  description = "The task lambda function log group"
  value       = module.add_input_granules_task.cumulus_task_log_group_name
}
