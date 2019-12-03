# API outputs

output "archive_api_uri" {
  value = module.archive.api_uri
}

output "archive_api_redirect_uri" {
  value = module.archive.api_redirect_uri
}

output "distribution_url" {
  value = module.distribution.distribution_url
}

output "distribution_redirect_uri" {
  value = module.distribution.thin_egress_app_redirect_uri
}

output "s3_credentials_redirect_uri" {
  value = module.distribution.s3_credentials_redirect_uri
}

# SNS topics

output "report_executions_sns_topic_arn" {
  value = module.archive.report_executions_sns_topic_arn
}

output "report_granules_sns_topic_arn" {
  value = module.archive.report_granules_sns_topic_arn
}

output "report_pdrs_sns_topic_arn" {
  value = module.archive.report_pdrs_sns_topic_arn
}

# Cumulus core task outputs

output "discover_granules_task" {
  value = module.ingest.discover_granules_task
}

output "discover_pdrs_task" {
  value = module.ingest.discover_pdrs_task
}

output "fake_processing_task" {
  value = module.ingest.fake_processing_task
}

output "files_to_granules_task" {
  value = module.ingest.files_to_granules_task
}

output "hello_world_task" {
  value = module.ingest.hello_world_task
}

output "move_granules_task" {
  value = module.ingest.move_granules_task
}

output "parse_pdr_task" {
  value = module.ingest.parse_pdr_task
}

output "pdr_status_check_task" {
  value = module.ingest.pdr_status_check_task
}

output "queue_granules_task" {
  value = module.ingest.queue_granules_task
}

output "queue_pdrs_task" {
  value = module.ingest.queue_pdrs_task
}

output "sf_sns_report_task" {
  value = module.ingest.sf_sns_report_task
}

output "sync_granule_task" {
  value = module.ingest.sync_granule_task
}

# Workflow config outputs

output "workflow_config" {
  value = {
    cw_sf_execution_event_to_db_lambda_function_arn = module.archive.cw_sf_execution_event_to_db_lambda_function_arn
    publish_reports_lambda_function_arn             = module.archive.publish_reports_lambda_function_arn
    sf_semaphore_down_lambda_function_arn           = module.ingest.sf_semaphore_down_lambda_function_arn
    state_machine_role_arn                          = module.ingest.step_role_arn
    sqs_message_remover_lambda_function_arn         = module.ingest.sqs_message_remover_lambda_function_arn
  }
}

# Other Lambda outputs

output "post_to_cmr_task" {
  value = module.ingest.post_to_cmr_task
}

output "log2elasticsearch_lambda_function_arn" {
  value = module.archive.log2elasticsearch_lambda_function_arn
}

output "sqs2sfThrottle_lambda_function_arn" {
  value = module.ingest.sqs2sfThrottle_lambda_function_arn
}

# IAM outputs

output "lambda_processing_role_arn" {
  value = aws_iam_role.lambda_processing.arn
}

output "scaling_role_arn" {
  value = module.ingest.scaling_role_arn
}

# ECS cluster

output "ecs_cluster_arn" {
  value = aws_ecs_cluster.default.arn
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.default.name
}
