output "archive_api_uri" {
  value = module.cumulus.archive_api_uri
}

output "archive_api_redirect_uri" {
  value = module.cumulus.archive_api_redirect_uri
}

output "distribution_url" {
  value = module.thin_egress_app.api_endpoint
}

output "s3_credentials_redirect_uri" {
  value = module.cumulus.s3_credentials_redirect_uri
}

output "distribution_redirect_uri" {
  value = module.thin_egress_app.urs_redirect_uri
}

# Workflow reporting SQS queue and SNS topics

output "stepfunction_event_reporter_queue_url" {
  value = module.cumulus.stepfunction_event_reporter_queue_url
}

output "report_executions_sns_topic_arn" {
  value = module.cumulus.report_executions_sns_topic_arn
}

output "report_granules_sns_topic_arn" {
  value = module.cumulus.report_granules_sns_topic_arn
}

output "report_pdrs_sns_topic_arn" {
  value = module.cumulus.report_pdrs_sns_topic_arn
}
