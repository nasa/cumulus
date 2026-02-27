output "cumulus_task_lambda" {
  description = "The task lambda function"
  value       = module.granule_invalidator_task.cumulus_task_lambda
}

output "cumulus_task_log_group_name" {
  description = "The task lambda function log group"
  value       = module.granule_invalidator_task.cumulus_task_log_group_name
}
