terraform {
  required_providers {
    aws  = ">= 3.5.0"
  }
}

provider "aws" {
  region  = var.region
<<<<<<< HEAD
=======
  profile = var.aws_profile

>>>>>>> a9be28c72... CUMULUS-2188 initial data-migration2 setup for migrating executions to RDS
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

<<<<<<< HEAD
module "data_migration2" {
  source = "../../lambdas/data-migration2"

  prefix = var.prefix

  permissions_boundary_arn = var.permissions_boundary_arn

  vpc_id            = var.vpc_id
  lambda_subnet_ids = var.subnet_ids

  dynamo_tables = data.terraform_remote_state.data_persistence.outputs.dynamo_tables

  rds_security_group_id = data.terraform_remote_state.data_persistence.outputs.rds_security_group
  rds_user_access_secret_arn = data.terraform_remote_state.data_persistence.outputs.database_credentials_secret_arn

  tags = merge(var.tags, { Deployment = var.prefix })
}
=======

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
>>>>>>> a9be28c72... CUMULUS-2188 initial data-migration2 setup for migrating executions to RDS
