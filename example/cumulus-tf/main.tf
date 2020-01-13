terraform {
  required_providers {
    aws  = ">= 2.31.0"
    null = "~> 2.1"
  }
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile
}

provider "aws" {
  alias   = "usw2"
  region  = "us-west-2"
  profile = var.aws_profile
}

locals {
  default_tags = {
    Deployment = var.prefix
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "terraform_remote_state" "data_persistence" {
  backend = "s3"
  config  = var.data_persistence_remote_state_config
  workspace = "${terraform.workspace}"
}

data "aws_lambda_function" "sts_credentials" {
  function_name = "gsfc-ngap-sh-s3-sts-get-keys"
}

module "cumulus" {
  source = "../../tf-modules/cumulus"

  cumulus_message_adapter_lambda_layer_arn = var.cumulus_message_adapter_lambda_layer_arn

  prefix = var.prefix

  vpc_id            = var.vpc_id
  lambda_subnet_ids = var.subnet_ids

  ecs_cluster_instance_image_id   = "ami-0fa9de75aa0a1f1b3"
  ecs_cluster_instance_subnet_ids = var.subnet_ids
  ecs_cluster_min_size            = 1
  ecs_cluster_desired_size        = 1
  ecs_cluster_max_size            = 2
  key_name                        = var.key_name

  urs_url             = "https://uat.urs.earthdata.nasa.gov"
  urs_client_id       = var.urs_client_id
  urs_client_password = var.urs_client_password

  ems_host              = var.ems_host
  ems_port              = var.ems_port
  ems_path              = var.ems_path
  ems_datasource        = var.ems_datasource
  ems_private_key       = var.ems_private_key
  ems_provider          = var.ems_provider
  ems_retention_in_days = var.ems_retention_in_days
  ems_submit_report     = var.ems_submit_report
  ems_username          = var.ems_username

  metrics_es_host     = var.metrics_es_host
  metrics_es_password = var.metrics_es_password
  metrics_es_username = var.metrics_es_username

  cmr_client_id   = var.cmr_client_id
  cmr_environment = "UAT"
  cmr_username    = var.cmr_username
  cmr_password    = var.cmr_password
  cmr_provider    = var.cmr_provider

  cmr_oauth_provider = var.cmr_oauth_provider

  launchpad_api         = var.launchpad_api
  launchpad_certificate = var.launchpad_certificate
  launchpad_passphrase  = var.launchpad_passphrase

  oauth_provider   = var.oauth_provider
  oauth_user_group = var.oauth_user_group

  saml_entity_id                  = var.saml_entity_id
  saml_assertion_consumer_service = var.saml_assertion_consumer_service
  saml_idp_login                  = var.saml_idp_login
  saml_launchpad_metadata_path    = var.saml_launchpad_metadata_path

  permissions_boundary_arn = var.permissions_boundary_arn

  system_bucket = var.system_bucket
  buckets       = var.buckets

  elasticsearch_alarms            = data.terraform_remote_state.data_persistence.outputs.elasticsearch_alarms
  elasticsearch_domain_arn        = data.terraform_remote_state.data_persistence.outputs.elasticsearch_domain_arn
  elasticsearch_hostname          = data.terraform_remote_state.data_persistence.outputs.elasticsearch_hostname
  elasticsearch_security_group_id = data.terraform_remote_state.data_persistence.outputs.elasticsearch_security_group_id

  dynamo_tables = data.terraform_remote_state.data_persistence.outputs.dynamo_tables

  token_secret = var.token_secret

  archive_api_users = [
    "chuckwondo",
    "jennyhliu",
    "jmcampbell",
    "jnorton1",
    "kbaynes",
    "kkelly",
    "kovarik",
    "lfrederick",
    "matthewsavoie",
    "mboyd",
    "menno.vandiermen",
    "mhuffnagle2",
    "pquinn1",
    "brian.tennity",
    "jasmine"
  ]

  distribution_url = var.distribution_url

  sts_credentials_lambda_function_arn = data.aws_lambda_function.sts_credentials.arn

  archive_api_port            = var.archive_api_port
  private_archive_api_gateway = var.private_archive_api_gateway
  api_gateway_stage = var.api_gateway_stage
  log_api_gateway_to_cloudwatch = var.log_api_gateway_to_cloudwatch
  log_destination_arn = var.log_destination_arn
}

resource "aws_security_group" "no_ingress_all_egress" {
  name   = "${var.prefix}-cumulus-tf-no-ingress-all-egress"
  vpc_id = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.default_tags
}

resource "aws_sns_topic_subscription" "sns_s3_test" {
  topic_arn = module.cumulus.report_executions_sns_topic_arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.sns_s3_test.arn
}

resource "aws_lambda_permission" "sns_s3_test" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sns_s3_test.arn
  principal     = "sns.amazonaws.com"
  source_arn    = module.cumulus.report_executions_sns_topic_arn
}

module "s3_access_test_lambda" {
  source = "./modules/s3_access_test"

  prefix                     = var.prefix
  lambda_processing_role_arn = module.cumulus.lambda_processing_role_arn

  providers = {
    aws = "aws.usw2"
  }
}
