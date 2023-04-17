module "archive" {
  source = "../archive"

  prefix = var.prefix

  api_url = var.archive_api_url

  deploy_to_ngap = var.deploy_to_ngap

  permissions_boundary_arn = var.permissions_boundary_arn

  lambda_processing_role_arn = aws_iam_role.lambda_processing.arn

  async_operation_image = var.async_operation_image
  ecs_cluster_name      = aws_ecs_cluster.default.name

  default_log_retention_days = var.default_log_retention_days
  cloudwatch_log_retention_periods = var.cloudwatch_log_retention_periods

  elasticsearch_client_config               = var.elasticsearch_client_config
  elasticsearch_domain_arn                  = var.elasticsearch_domain_arn
  elasticsearch_hostname                    = var.elasticsearch_hostname
  elasticsearch_security_group_id           = var.elasticsearch_security_group_id
  elasticsearch_remove_index_alias_conflict = var.elasticsearch_remove_index_alias_conflict


  es_index_shards        = var.es_index_shards
  es_request_concurrency = var.es_request_concurrency

  system_bucket     = var.system_bucket
  buckets           = var.buckets

  ecs_task_role      = {
    name = aws_iam_role.ecs_task_role.name,
    arn  = aws_iam_role.ecs_task_role.arn,
  }
  ecs_execution_role = {
    name = aws_iam_role.ecs_execution_role.name,
    arn  = aws_iam_role.ecs_execution_role.arn,
  }

  vpc_id            = var.vpc_id
  lambda_subnet_ids = var.lambda_subnet_ids

  cmr_client_id      = var.cmr_client_id
  cmr_environment    = var.cmr_environment
  cmr_oauth_provider = var.cmr_oauth_provider
  cmr_provider       = var.cmr_provider
  cmr_username       = var.cmr_username
  cmr_password       = var.cmr_password
  cmr_custom_host    = var.cmr_custom_host
  cmr_search_client_config = var.cmr_search_client_config

  launchpad_api         = var.launchpad_api
  launchpad_certificate = var.launchpad_certificate
  launchpad_passphrase  = var.launchpad_passphrase

  orca_api_uri       = var.orca_api_uri

  saml_entity_id                  = var.saml_entity_id
  saml_assertion_consumer_service = var.saml_assertion_consumer_service
  saml_idp_login                  = var.saml_idp_login
  saml_launchpad_metadata_url     = var.saml_launchpad_metadata_url

  urs_url             = var.urs_url
  urs_client_id       = var.urs_client_id
  urs_client_password = var.urs_client_password

  token_secret = var.token_secret

  dynamo_tables = var.dynamo_tables

  api_port = var.archive_api_port
  private_archive_api_gateway = var.private_archive_api_gateway
  api_gateway_stage = var.api_gateway_stage
  api_reserved_concurrency = var.archive_api_reserved_concurrency

  schedule_sf_function_arn                         = module.ingest.schedule_sf_lambda_function_arn
  manual_consumer_function_arn                     = module.ingest.manual_consumer_lambda_function_arn
  message_consumer_function_arn                    = module.ingest.message_consumer_lambda_function_arn
  kinesis_fallback_topic_arn                       = module.ingest.kinesis_fallback_topic_arn
  kinesis_inbound_event_logger_lambda_function_arn = module.ingest.kinesis_inbound_event_logger_lambda_function_arn

  metrics_es_host     = var.metrics_es_host
  metrics_es_password = var.metrics_es_password
  metrics_es_username = var.metrics_es_username

  daily_execution_payload_cleanup_schedule_expression = var.daily_execution_payload_cleanup_schedule_expression
  complete_execution_payload_timeout_disable = var.complete_execution_payload_timeout_disable
  complete_execution_payload_timeout = var.complete_execution_payload_timeout
  non_complete_execution_payload_timeout_disable = var.non_complete_execution_payload_timeout_disable
  non_complete_execution_payload_timeout = var.non_complete_execution_payload_timeout

  background_queue_url = module.ingest.background_queue_url

  distribution_api_id = var.tea_rest_api_id
  distribution_url = var.tea_external_api_endpoint

  users = var.archive_api_users

  oauth_provider   = var.oauth_provider
  oauth_user_group = var.oauth_user_group

  log_destination_arn = var.log_destination_arn

  rds_security_group = var.rds_security_group
  rds_user_access_secret_arn = var.rds_user_access_secret_arn
  rds_connection_timing_configuration    = var.rds_connection_timing_configuration
  postgres_migration_count_tool_function_arn = module.postgres_migration_count_tool.postgres_migration_count_tool_function_arn
  postgres_migration_async_operation_function_arn = module.postgres_migration_async_operation.postgres_migration_async_operation_function_arn

  tags = var.tags
}
