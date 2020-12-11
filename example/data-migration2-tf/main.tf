terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 3.5.0"
    }
  }
}

provider "aws" {
<<<<<<< HEAD
<<<<<<< HEAD
  region = var.region
=======
<<<<<<< HEAD
  region  = var.region
=======
>>>>>>> c08f83d59... CUMULUS-2188 complete data-migration2 terraform template
>>>>>>> a5e4a7828... CUMULUS-2188 complete data-migration2 terraform template
=======
  region  = var.region
>>>>>>> fcc52f447... CUMULUS-2188 complete terraform template for data migration ECS service
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

module "data_migration2" {
  source = "../../lambdas/data-migration2"

  prefix = var.prefix

  permissions_boundary_arn = var.permissions_boundary_arn

  vpc_id            = var.vpc_id
  lambda_subnet_ids = var.subnet_ids

  dynamo_tables = data.terraform_remote_state.data_persistence.outputs.dynamo_tables

  rds_security_group_id      = data.terraform_remote_state.data_persistence.outputs.rds_security_group
  rds_user_access_secret_arn = data.terraform_remote_state.data_persistence.outputs.database_credentials_secret_arn

  tags = merge(var.tags, { Deployment = var.prefix })
}
