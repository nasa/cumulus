output "api_uri" {
  value = local.api_uri
}

output "api_redirect_uri" {
  value = local.api_redirect_uri
}

output "cw_sf_event_to_db_records_lambda_function_arn" {
  value = aws_lambda_function.cw_sf_event_to_db_records.arn
}

output "log2elasticsearch_lambda_function_arn" {
  value = aws_lambda_function.log2elasticsearch.arn
}

output "provider_kms_key_arn" {
  value = aws_kms_key.provider_kms_key.arn
}

output "publish_reports_lambda_function_arn" {
  value = aws_lambda_function.publish_reports.arn
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
