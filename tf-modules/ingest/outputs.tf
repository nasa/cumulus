output "fake_processing_task_lambda_function_arn" {
  value = aws_lambda_function.fake_processing_task.arn
}

output "files_to_granules_task_lambda_function_arn" {
  value = aws_lambda_function.files_to_granules_task.arn
}

output "kinesis_inbound_event_logger_lambda_function_arn" {
  value = aws_lambda_function.kinesis_inbound_event_logger.arn
}

output "message_consumer_lambda_function_arn" {
  value = aws_lambda_function.message_consumer.arn
}

output "move_granules_task_lambda_function_arn" {
  value = aws_lambda_function.move_granules_task.arn
}

output "post_to_cmr_task_lambda_function_arn" {
  value = aws_lambda_function.post_to_cmr_task.arn
}

output "schedule_sf_lambda_function_arn" {
  value = aws_lambda_function.schedule_sf.arn
}

output "sf_sns_report_task_lambda_function_arn" {
  value = aws_lambda_function.sf_sns_report_task.arn
}

output "sf_semaphore_down_lambda_function_arn" {
  value = aws_lambda_function.sf_semaphore_down.arn
}

output "sync_granule_task_lambda_function_arn" {
  value = aws_lambda_function.sync_granule_task.arn
}

output "step_role_arn" {
  value = aws_iam_role.step.arn
}
