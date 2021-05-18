terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 2.31.0"
    }
  }
}

data "aws_region" "current" {}

resource "aws_dynamodb_table" "access_tokens" {
  name         = "${var.prefix}-DistributionAccessTokensTable"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "accessToken"

  attribute {
    name = "accessToken"
    type = "S"
  }

  tags = var.tags
}
