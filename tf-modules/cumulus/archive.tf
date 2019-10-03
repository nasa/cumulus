module "archive" {
  source = "../archive"

  prefix = var.prefix
  region = var.region

  permissions_boundary_arn = var.permissions_boundary_arn

  lambda_processing_role_arn = aws_iam_role.lambda_processing.arn

  ecs_cluster_name = aws_ecs_cluster.default.name

  elasticsearch_domain_arn        = var.elasticsearch_domain_arn
  elasticsearch_hostname          = var.elasticsearch_hostname
  elasticsearch_security_group_id = var.elasticsearch_security_group_id

  ems_host = "change-ems-host"

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

  urs_url             = "https://uat.urs.earthdata.nasa.gov"
  urs_client_id       = var.urs_client_id
  urs_client_password = var.urs_client_password

  token_secret = var.token_secret

  dynamo_tables = var.dynamo_tables

  api_port = var.archive_api_port

  schedule_sf_function_arn                         = module.ingest.schedule_sf_lambda_function_arn
  message_consumer_function_arn                    = module.ingest.message_consumer_lambda_function_arn
  kinesis_inbound_event_logger_lambda_function_arn = module.ingest.kinesis_inbound_event_logger_lambda_function_arn

  # TODO We need to figure out how to make this dynamic
  #
  # From @mboyd
  # OK, well I can help you unwind that ball of yarn when you get to it.
  # However, I was curious so I looked into it.
  #
  # The name here is backgroundProcessing (without prefix) because that is the
  # key of the queue in meta.queues of the execution message. The reason for
  # that is in the code that creates the workflow templates:
  #
  # https://github.com/nasa/cumulus/blob/master/packages/deployment/lib/message.js#L115
  #
  # It gets the queue names by stripping SQSOutput from the Cloudformation
  # template outputs. And these template outputs do not include prefix, but just
  # the keys of the queues from config.sqs, thus backgroundProcessing
  background_queue_name = "backgroundProcessing"

  distribution_api_id = module.distribution.rest_api_id
  distribution_url    = module.distribution.distribution_url

  users = var.archive_api_users

  oauth_provider   = var.oauth_provider
  oauth_user_group = var.oauth_user_group
}
