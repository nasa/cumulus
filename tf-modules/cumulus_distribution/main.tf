terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.100, < 6.0.0"
    }
  }
}

locals {
  all_non_internal_buckets = [for k, v in var.buckets : v.name if v.type != "internal"]
  public_buckets         = [for k, v in var.buckets : v.name if v.type == "public"]
  protected_buckets      = [for k, v in var.buckets : v.name if v.type == "protected"]
  lambda_security_group_ids = [aws_security_group.no_ingress_all_egress[0].id]
  allowed_buckets = compact(flatten([
    local.all_non_internal_buckets,
    var.system_bucket
  ]))
  distribution_buckets   = concat(local.protected_buckets, local.public_buckets)
  distribution_bucket_map_key = "${var.prefix}/distribution_bucket_map.json"
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

  ttl {
    attribute_name = "expirationTime"
    enabled        = true
  }

  tags = var.tags
}
