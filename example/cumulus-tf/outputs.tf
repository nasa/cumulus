output "archive_api_uri" {
  value = module.cumulus.archive_api_uri
}

output "archive_api_redirect_uri" {
  value = module.cumulus.archive_api_redirect_uri
}

# TEA-Specific outputs

output "distribution_url" {
  value = try(module.thin_egress_app.api_endpoint, null)
}

output "s3_credentials_redirect_uri" {
  value = try(module.cumulus.s3_credentials_redirect_uri, null)
}

output "distribution_redirect_uri" {
  value = try(module.thin_egress_app.urs_redirect_uri, null)
}

# End TEA-Specific outputs.

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

output "lzards_backup_task" {
  value = module.cumulus.lzards_backup_task
}

output "move_granules_task" {
  value = module.cumulus.move_granules_task
}

# TODO: only if not TEA
output "distribution_api_uri" {
  value = module.cumulus_distribution.api_uri
}

output "distribution_api_redirect_uri" {
  value = module.cumulus_distribution.api_redirect_uri
}
