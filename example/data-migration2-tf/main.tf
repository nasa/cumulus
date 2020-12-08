terraform {
  required_providers {
    aws  = ">= 3.5.0"
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
}

data "terraform_remote_state" "data_persistence" {
  backend   = "s3"
  config    = var.data_persistence_remote_state_config
  workspace = terraform.workspace
}


module "data_migration2_ecs_service" {
  source = "https://github.com/nasa/cumulus/releases/download/v4.0.0/terraform-aws-cumulus-ecs-service.zip"

  prefix = var.prefix
  name   = "ExecutionMigrationService"

  log2elasticsearch_lambda_function_arn = module.cumulus.log2elasticsearch_lambda_function_arn
  cluster_arn                           = module.cumulus.ecs_cluster_arn
  desired_count                         = 1
  image                                 = "cumuluss/cumulus-ecs-task:1.7.0"

  environment = {
    lambdaArn: var.data_migration2_function_arn
  }
}