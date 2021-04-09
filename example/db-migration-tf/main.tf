terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 3.5.0"
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

locals {
  rds_security_group         = lookup(data.terraform_remote_state.data_persistence.outputs, "rds_security_group", var.rds_security_group)
  rds_credentials_secret_arn = lookup(data.terraform_remote_state.data_persistence.outputs, "database_credentials_secret_arn", var.rds_user_access_secret_arn)
}