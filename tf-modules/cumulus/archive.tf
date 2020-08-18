module "archive" {
  source = "../archive"

  prefix = var.prefix

  api_url = var.archive_api_url

  deploy_to_ngap = var.deploy_to_ngap

  permissions_boundary_arn = var.permissions_boundary_arn

  lambda_processing_role_arn = aws_iam_role.lambda_processing.arn

  ecs_cluster_name = aws_ecs_cluster.default.name

  elasticsearch_domain_arn        = var.elasticsearch_domain_arn
  elasticsearch_hostname          = var.elasticsearch_hostname
  elasticsearch_security_group_id = var.elasticsearch_security_group_id

  ems_host              = var.ems_host
  ems_port              = var.ems_port
  ems_path              = var.ems_path
  ems_datasource        = var.ems_datasource
  ems_private_key       = var.ems_private_key
  ems_provider          = var.ems_provider
  ems_retention_in_days = var.ems_retention_in_days
  ems_submit_report     = var.ems_submit_report
  ems_username          = var.ems_username

  es_index_shards        = var.es_index_shards
  es_request_concurrency = var.es_request_concurrency

  system_bucket     = var.system_bucket
  public_buckets    = local.public_bucket_names
  protected_buckets = local.protected_bucket_names
  private_buckets   = local.private_bucket_names

  vpc_id            = var.vpc_id
  lambda_subnet_ids = var.lambda_subnet_ids

  cmr_client_id      = var.cmr_client_id
  cmr_environment    = var.cmr_environment
  cmr_oauth_provider = var.cmr_oauth_provider
  cmr_provider       = var.cmr_provider
  cmr_username       = var.cmr_username
  cmr_password       = var.cmr_password

  launchpad_api         = var.launchpad_api
  launchpad_certificate = var.launchpad_certificate
  launchpad_passphrase  = var.launchpad_passphrase

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

  distribution_api_id = module.distribution.rest_api_id
  distribution_url    = module.distribution.distribution_url

  users = var.archive_api_users

  oauth_provider   = var.oauth_provider
  oauth_user_group = var.oauth_user_group

  log_destination_arn = var.log_destination_arn

  tags = var.tags
}
