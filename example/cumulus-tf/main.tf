provider "aws" {
  region  = var.region
  profile = var.aws_profile
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "terraform_remote_state" "data_persistence" {
  backend = "s3"
  config  = var.data_persistence_remote_state_config
}

data "aws_lambda_function" "sts_credentials" {
  function_name = "gsfc-ngap-sh-s3-sts-get-keys"
}

module "cumulus" {
  source = "../../tf-modules/cumulus"

  prefix = var.prefix

  vpc_id            = var.vpc_id
  lambda_subnet_ids = var.subnet_ids

  ecs_cluster_instance_subnet_ids = var.subnet_ids
  ecs_cluster_min_size            = 1
  ecs_cluster_desired_size        = 1
  ecs_cluster_max_size            = 2
  key_name                        = var.key_name

  urs_url             = "https://uat.urs.earthdata.nasa.gov"
  urs_client_id       = var.urs_client_id
  urs_client_password = var.urs_client_password

  cmr_client_id   = var.cmr_client_id
  cmr_environment = "UAT"
  cmr_username    = var.cmr_username
  cmr_password    = var.cmr_password
  cmr_provider    = var.cmr_provider

  permissions_boundary_arn = var.permissions_boundary_arn

  system_bucket     = var.system_bucket
  public_buckets    = var.public_buckets
  protected_buckets = var.protected_buckets
  private_buckets   = var.private_buckets

  elasticsearch_domain_arn        = data.terraform_remote_state.data_persistence.outputs.elasticsearch_domain_arn
  elasticsearch_hostname          = data.terraform_remote_state.data_persistence.outputs.elasticsearch_hostname
  elasticsearch_security_group_id = data.terraform_remote_state.data_persistence.outputs.elasticsearch_security_group_id

  dynamo_tables = data.terraform_remote_state.data_persistence.outputs.dynamo_tables

  token_secret = var.token_secret

  archive_api_users = [
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
    "pquinn1"
  ]

  distribution_url = var.distribution_url

  sts_credentials_lambda_function_arn = data.aws_lambda_function.sts_credentials.arn
}

# TODO Add this aws_sns_topic_subscription
# Subscribes to module.archive.aws_sns_topic.sftracker
# - Endpoint:
#     Fn::GetAtt:
#       - SnsS3TestLambdaFunction
#       - Arn
#   Protocol: lambda

# TODO Add this permission to example
# Related to module.archive.aws_sns_topic.sftracker
# sftracker2ndlambdaSubscriptionPermission:
#   Type: AWS::Lambda::Permission
#   Properties:
#     FunctionName:
#       Fn::GetAtt:
#         - SnsS3TestLambdaFunction
#         - Arn
#     Action: lambda:InvokeFunction
#     Principal: sns.amazonaws.com
#     SourceArn:
#       Ref: sftrackerSns
