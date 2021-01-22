terraform {
  required_providers {
    aws  = ">= 3.5.0"
  }
}

provider "aws" {
  region  = var.region
  ignore_tags {
    key_prefixes = ["gsfc-ngap"]
  }
}

module "data_migration_ecs_service" {
  source = "https://github.com/nasa/cumulus/releases/download/v4.0.0/terraform-aws-cumulus-ecs-service.zip"

  prefix = var.prefix
  name   = "ExecutionMigrationService"

  log2elasticsearch_lambda_function_arn = var.log2elasticsearch_lambda_function_arn
  cluster_arn                           = var.ecs_cluster_arn
  desired_count                         = 1
  image                                 = "cumuluss/cumulus-ecs-task:1.7.0"

  command = [
    "cumulus-ecs-task",
    "--lambdaArn",
    var.data_migration2_function_arn
  ]
}
