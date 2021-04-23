output "api_uri" {
  value = local.api_uri
}

output "api_redirect_uri" {
  value = local.api_redirect_uri
}

output "async_operation_task_definition_arn" {
  value = aws_ecs_task_definition.async_operation.arn
}

output "sf_event_sqs_to_db_records_sqs_queue_url" {
  value = aws_sqs_queue.sf_event_sqs_to_db_records_input_queue.id
}

output "sf_event_sqs_to_db_records_sqs_queue_arn" {
  value = aws_sqs_queue.sf_event_sqs_to_db_records_input_queue.arn
}

output "provider_kms_key_arn" {
  value = aws_kms_key.provider_kms_key.arn
}

output "provider_kms_key_id" {
  value = aws_kms_key.provider_kms_key.id
}

output "report_collections_sns_topic_arn" {
  value = aws_sns_topic.report_collections_topic.arn
}

output "report_executions_sns_topic_arn" {
  value = aws_sns_topic.report_executions_topic.arn
}

output "report_granules_sns_topic_arn" {
  value = aws_sns_topic.report_granules_topic.arn
}

output "report_pdrs_sns_topic_arn" {
  value = aws_sns_topic.report_pdrs_topic.arn
}

output "async_operation_log_group" {
  value = aws_cloudwatch_log_group.async_operation.name
}

output "cmr_password_secret_arn" {
  value = aws_secretsmanager_secret.api_cmr_password.arn
}

output "launchpad_passphrase_secret_arn" {
  value = aws_secretsmanager_secret.api_launchpad_passphrase.arn
}
