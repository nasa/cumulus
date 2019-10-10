output "api_uri" {
  value = local.api_uri
}

output "api_redirect_uri" {
  value = local.api_redirect_uri
}

output "encrypted_cmr_password" {
  value = jsondecode(data.aws_lambda_invocation.custom_bootstrap.result).Data.CmrPassword
}

output "encrypted_launchpad_passphrase" {
  value = jsondecode(data.aws_lambda_invocation.custom_bootstrap.result).Data.LaunchpadPassphrase
}

output "sftracker_sns_topic_arn" {
  value = aws_sns_topic.sftracker.arn
}

output "log2elasticsearch_lambda_function_arn" {
  value = aws_lambda_function.log2elasticsearch.arn
}

output "report_executions_sns_topic_arn" {
  value = aws_sns_topic.report_executions_topic.arn
}
