terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.100, < 6.0.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.1.0"
    }
  }
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  ignore_tags {
    key_prefixes = ["gsfc-ngap"]
  }
}

provider "aws" {
  alias   = "usw2"
  region  = "us-west-2"
  profile = var.aws_profile

  ignore_tags {
    key_prefixes = ["gsfc-ngap"]
  }
}

locals {
  tags                            = merge(var.tags, { Deployment = var.prefix })
  protected_bucket_names          = [for k, v in var.buckets : v.name if v.type == "protected"]
  public_bucket_names             = [for k, v in var.buckets : v.name if v.type == "public"]
  rds_security_group              = lookup(data.terraform_remote_state.data_persistence.outputs, "rds_security_group", "")
  rds_credentials_secret_arn      = lookup(data.terraform_remote_state.data_persistence.outputs, "database_credentials_secret_arn", "")

  vpc_id     = var.vpc_id != null ? var.vpc_id : data.aws_vpc.application_vpc[0].id
  subnet_ids = length(var.lambda_subnet_ids) > 0 ? var.lambda_subnet_ids : data.aws_subnets.subnet_ids[0].ids
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "terraform_remote_state" "data_persistence" {
  backend   = "s3"
  config    = var.data_persistence_remote_state_config
  workspace = terraform.workspace
}

data "aws_lambda_function" "sts_credentials" {
  function_name = "gsfc-ngap-sh-s3-sts-get-keys"
}

data "aws_lambda_function" "sts_policy_helper" {
  function_name = "gsfc-ngap-sh-sts-policy-helper"
}

data "aws_ssm_parameter" "ecs_image_id" {
  name = "/ngap/amis/image_id_ecs_al2023_x86"
}

data "aws_ecr_repository" "async_operation" {
  name = "async_operations"
}

module "cumulus" {
  source = "../../tf-modules/cumulus"

  cumulus_message_adapter_lambda_layer_version_arn = var.cumulus_message_adapter_lambda_layer_version_arn

  prefix = var.prefix

  deploy_to_ngap = true

  bucket_map_key = var.bucket_map_key
  throttled_queues = [{
    url = aws_sqs_queue.throttled_queue.id
    execution_limit = 30
  }]

  vpc_id            = var.vpc_id != null ? var.vpc_id : data.aws_vpc.application_vpc[0].id

  lambda_subnet_ids   = local.subnet_ids
  lambda_timeouts     = var.lambda_timeouts
  lambda_memory_sizes = var.lambda_memory_sizes

  rds_security_group                     = local.rds_security_group
  rds_user_access_secret_arn             = local.rds_credentials_secret_arn
  rds_connection_timing_configuration    = var.rds_connection_timing_configuration

  async_operation_image = "${data.aws_ecr_repository.async_operation.repository_url}:${var.async_operation_image_version}"

  ecs_cluster_instance_image_id   = data.aws_ssm_parameter.ecs_image_id.value
  ecs_cluster_instance_subnet_ids = length(var.ecs_cluster_instance_subnet_ids) == 0 ? local.subnet_ids : var.ecs_cluster_instance_subnet_ids
  ecs_cluster_min_size            = 2
  ecs_cluster_desired_size        = 2
  ecs_cluster_max_size            = 3
  ecs_include_docker_cleanup_cronjob = var.ecs_include_docker_cleanup_cronjob
  key_name                        = var.key_name
  ecs_custom_sg_ids               = var.ecs_custom_sg_ids

  urs_url             = "https://uat.urs.earthdata.nasa.gov"
  urs_client_id       = var.urs_client_id
  urs_client_password = var.urs_client_password

  metrics_es_host     = var.metrics_es_host
  metrics_es_password = var.metrics_es_password
  metrics_es_username = var.metrics_es_username

  cmr_client_id   = var.cmr_client_id
  cmr_environment = "UAT"
  cmr_username    = var.cmr_username
  cmr_password    = var.cmr_password
  cmr_provider    = var.cmr_provider
  cmr_custom_host = var.cmr_custom_host

  cmr_search_client_config = var.cmr_search_client_config

  cmr_oauth_provider = var.cmr_oauth_provider

  default_s3_multipart_chunksize_mb = var.default_s3_multipart_chunksize_mb
  sync_granule_s3_jitter_max_ms     = var.sync_granule_s3_jitter_max_ms

  launchpad_api         = var.launchpad_api
  launchpad_certificate = var.launchpad_certificate
  launchpad_passphrase  = var.launchpad_passphrase

  lzards_launchpad_certificate = var.launchpad_certificate
  lzards_launchpad_passphrase  = var.launchpad_passphrase
  lzards_api                   = var.lzards_api
  lzards_provider              = var.lzards_provider
  lzards_s3_link_timeout       = var.lzards_s3_link_timeout

  oauth_provider   = var.oauth_provider
  oauth_user_group = var.oauth_user_group

  orca_api_uri = module.orca.orca_api_deployment_invoke_url

  orca_lambda_copy_to_archive_arn = module.orca.orca_lambda_copy_to_archive_arn
  orca_sfn_recovery_workflow_arn = module.orca.orca_sfn_recovery_workflow_arn

  saml_entity_id                  = var.saml_entity_id
  saml_assertion_consumer_service = var.saml_assertion_consumer_service
  saml_idp_login                  = var.saml_idp_login
  saml_launchpad_metadata_url     = var.saml_launchpad_metadata_url

  permissions_boundary_arn = var.permissions_boundary_arn

  system_bucket = var.system_bucket
  buckets       = var.buckets

  dynamo_tables = merge(data.terraform_remote_state.data_persistence.outputs.dynamo_tables, var.optional_dynamo_tables)
  default_log_retention_days = var.default_log_retention_days
  cloudwatch_log_retention_periods = var.cloudwatch_log_retention_periods

  report_sns_topic_subscriber_arns = var.report_sns_topic_subscriber_arns

  # Archive API settings
  token_secret = var.token_secret
  archive_api_users = var.archive_api_users

  archive_api_url             = var.archive_api_url
  archive_api_port            = var.archive_api_port
  private_archive_api_gateway = var.private_archive_api_gateway
  api_gateway_stage           = var.api_gateway_stage
  archive_api_reserved_concurrency = var.api_reserved_concurrency

  # Thin Egress App settings. Uncomment to use TEA.
  # must match stage_name variable for thin-egress-app module
  # tea_api_gateway_stage         = local.tea_stage_name
  # tea_rest_api_id               = module.thin_egress_app.rest_api.id
  # tea_rest_api_root_resource_id = module.thin_egress_app.rest_api.root_resource_id
  # tea_internal_api_endpoint     = module.thin_egress_app.internal_api_endpoint
  # tea_external_api_endpoint     = module.thin_egress_app.api_endpoint

  log_destination_arn = var.log_destination_arn


  # DLA Recovery Tool Task settings
  dead_letter_recovery_cpu = var.dead_letter_recovery_cpu
  dead_letter_recovery_memory = var.dead_letter_recovery_memory


  # Cumulus Distribution settings. Remove/comment to use TEA
  tea_external_api_endpoint = module.cumulus_distribution.api_uri

  deploy_cumulus_distribution = var.deploy_cumulus_distribution

  # S3 credentials endpoint
  sts_credentials_lambda_function_arn = data.aws_lambda_function.sts_credentials.arn
  sts_policy_helper_lambda_function_arn = data.aws_lambda_function.sts_policy_helper.arn
  cmr_acl_based_credentials = true

  additional_log_groups_to_elk = var.additional_log_groups_to_elk

  # workflow configuration
  workflow_configurations = var.workflow_configurations

  tags = local.tags

  # For message consumer lambdas in order to disable rule/message mismatches
  allow_provider_mismatch_on_rule_filter = var.allow_provider_mismatch_on_rule_filter
}

resource "aws_security_group" "no_ingress_all_egress" {
  name   = "${var.prefix}-cumulus-tf-no-ingress-all-egress"
  vpc_id = local.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

resource "aws_sns_topic_subscription" "sns_s3_executions_test" {
  topic_arn = module.cumulus.report_executions_sns_topic_arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.sns_s3_executions_test.arn
}

resource "aws_lambda_permission" "sns_s3_executions_test" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sns_s3_executions_test.arn
  principal     = "sns.amazonaws.com"
  source_arn    = module.cumulus.report_executions_sns_topic_arn
}

resource "aws_sns_topic_subscription" "sns_s3_granules_test" {
  topic_arn = module.cumulus.report_granules_sns_topic_arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.sns_s3_granules_test.arn
}

resource "aws_lambda_permission" "sns_s3_granules_test" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sns_s3_granules_test.arn
  principal     = "sns.amazonaws.com"
  source_arn    = module.cumulus.report_granules_sns_topic_arn
}

resource "aws_sns_topic_subscription" "sns_s3_pdrs_test" {
  topic_arn = module.cumulus.report_pdrs_sns_topic_arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.sns_s3_pdrs_test.arn
}

resource "aws_lambda_permission" "sns_s3_pdrs_test" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sns_s3_pdrs_test.arn
  principal     = "sns.amazonaws.com"
  source_arn    = module.cumulus.report_pdrs_sns_topic_arn
}

resource "aws_sns_topic_subscription" "sns_s3_collections_test" {
  topic_arn = module.cumulus.report_collections_sns_topic_arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.sns_s3_collections_test.arn
}

resource "aws_lambda_permission" "sns_s3_collections_test" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sns_s3_collections_test.arn
  principal     = "sns.amazonaws.com"
  source_arn    = module.cumulus.report_collections_sns_topic_arn
}

module "s3_access_test_lambda" {
  source = "./modules/s3_access_test"

  prefix                     = var.prefix
  lambda_processing_role_arn = module.cumulus.lambda_processing_role_arn

  providers = {
    aws = aws.usw2
  }

  tags = local.tags
}
