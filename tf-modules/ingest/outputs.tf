output "discover_granules_task" {
  value = module.discover_granules_task
}

output "discover_pdrs_task" {
  value = module.discover_pdrs_task
}

output "fake_processing_task" {
  value = module.fake_processing_task
}

output "files_to_granules_task" {
  value = module.files_to_granules_task
}

output "hello_world_task" {
  value = module.hello_world_task
}

output "kinesis_inbound_event_logger_lambda_function_arn" {
  value = aws_lambda_function.kinesis_inbound_event_logger.arn
}

output "message_consumer_lambda_function_arn" {
  value = aws_lambda_function.message_consumer.arn
}

output "move_granules_task" {
  value = module.move_granules_task
}

output "parse_pdr_task" {
  value = module.parse_pdr_task
}

output "pdr_status_check_task" {
  value = module.pdr_status_check_task
}

output "post_to_cmr_task" {
  value = module.post_to_cmr_task
}

output "queue_granules_task" {
  value = module.queue_granules_task
}

output "queue_pdrs_task" {
  value = module.queue_pdrs_task
}

output "schedule_sf_lambda_function_arn" {
  value = aws_lambda_function.schedule_sf.arn
}

output "sf_sns_report_task" {
  value = {
    task_arn = aws_lambda_function.sf_sns_report_task.arn
  }
}

output "sf_semaphore_down_lambda_function_arn" {
  value = aws_lambda_function.sf_semaphore_down.arn
}

output "sqs2sfThrottle_lambda_function_arn" {
  value = aws_lambda_function.sqs2sfThrottle.arn
}

output "sync_granule_task" {
  value = module.sync_granule_task
}

output "step_role_arn" {
  value = aws_iam_role.step.arn
}

output "scaling_role_arn" {
  value = aws_iam_role.scaling.arn
}
