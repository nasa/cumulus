module "ingest" {
  source = "../ingest"

  prefix = var.prefix

  buckets = var.buckets

  distribution_url = var.tea_external_api_endpoint

  cumulus_message_adapter_lambda_layer_version_arn = var.cumulus_message_adapter_lambda_layer_version_arn

  # Buckets config
  system_bucket = var.system_bucket

  # VPC config
  vpc_id            = var.vpc_id
  lambda_subnet_ids = var.lambda_subnet_ids

  # IAM config
  permissions_boundary_arn   = var.permissions_boundary_arn
  lambda_processing_role_arn = aws_iam_role.lambda_processing.arn

  # CMR config
  cmr_oauth_provider = var.cmr_oauth_provider
  cmr_username       = var.cmr_username
  cmr_provider       = var.cmr_provider
  cmr_client_id      = var.cmr_client_id
  cmr_password       = var.cmr_password
  cmr_environment    = var.cmr_environment
  cmr_limit          = var.cmr_limit
  cmr_page_size      = var.cmr_page_size
  cmr_custom_host    = var.cmr_custom_host

  default_s3_multipart_chunksize_mb = var.default_s3_multipart_chunksize_mb
  lambda_timeouts       = var.lambda_timeouts
  lambda_memory_sizes   = var.lambda_memory_sizes
  
  # Launchpad config
  launchpad_api         = var.launchpad_api
  launchpad_passphrase  = var.launchpad_passphrase
  launchpad_certificate = var.launchpad_certificate

  # LZARDS config
  lzards_launchpad_passphrase  = var.lzards_launchpad_passphrase
  lzards_launchpad_certificate = var.lzards_launchpad_certificate
  lzards_api                   = var.lzards_api
  lzards_provider              = var.lzards_provider
  lzards_s3_link_timeout       = var.lzards_s3_link_timeout

  # DB config
  dynamo_tables = var.dynamo_tables

  custom_queues = var.custom_queues
  throttled_queues = var.throttled_queues

  sf_event_sqs_to_db_records_sqs_queue_url = module.archive.sf_event_sqs_to_db_records_sqs_queue_url

  tags = var.tags

  # Cloudwatch log retention config
  default_log_retention_days = var.default_log_retention_days
  cloudwatch_log_retention_periods = var.cloudwatch_log_retention_periods
}
