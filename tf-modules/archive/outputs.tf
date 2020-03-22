output "api_uri" {
  value = local.api_uri
}

output "api_redirect_uri" {
  value = local.api_redirect_uri
}

output "sf_event_sqs_to_db_records_sqs_queue_url" {
  value = aws_sqs_queue.sf_event_sqs_to_db_records_input_queue.id
}

output "sf_event_sqs_to_db_records_sqs_queue_arn" {
  value = aws_sqs_queue.sf_event_sqs_to_db_records_input_queue.arn
}

output "log2elasticsearch_lambda_function_arn" {
  value = aws_lambda_function.log2elasticsearch.arn
}

output "provider_kms_key_arn" {
  value = aws_kms_key.provider_kms_key.arn
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
