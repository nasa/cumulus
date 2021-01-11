terraform {
  required_providers {
    aws = ">= 2.31.0"
  }
}

locals {
  tea_buckets = concat(var.protected_buckets, var.public_buckets)
}

module "tea_map_cache" {
  prefix                     = var.prefix
  source                     = "../tea-map-cache"
  lambda_processing_role_arn = var.lambda_processing_role_arn
  tea_api_url                = var.tea_internal_api_endpoint
  tags                       = var.tags
  lambda_subnet_ids          = var.lambda_subnet_ids
  vpc_id                     = var.vpc_id
  deploy_to_ngap             = var.deploy_to_ngap
}

data "aws_lambda_invocation" "tea_map_cache" {
  depends_on                      = [module.tea_map_cache.lambda_function_name]
  function_name                   = module.tea_map_cache.lambda_function_name
  input                           = jsonencode({ bucketList = local.tea_buckets,
                                                 s3Bucket = var.system_bucket
                                                 s3Key = "${var.prefix}/distribution_bucket_map.json"
  })
}
