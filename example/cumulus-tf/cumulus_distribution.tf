locals {
  distribution_api_gateway_stage = "dev"
}

module "cumulus_distribution" {
  source                    = "../../tf-modules/cumulus_distribution"
  deploy_to_ngap            = true
  prefix                    = var.prefix
  api_gateway_stage         = local.distribution_api_gateway_stage
  lambda_subnet_ids         = var.lambda_subnet_ids
  cmr_acl_based_credentials = var.cmr_acl_based_credentials
  cmr_environment           = var.cmr_environment
  cmr_provider              = var.cmr_provider
  permissions_boundary_arn  = var.permissions_boundary_arn
  public_buckets            = local.public_bucket_names
  urs_url                   = var.urs_url
  urs_client_id             = var.urs_client_id
  urs_client_password       = var.urs_client_password
  sts_credentials_lambda_function_arn         = var.sts_credentials_lambda_function_arn
  sts_policy_helper_lambda_function_arn       = var.sts_policy_helper_lambda_function_arn
  tags                      = local.tags
  vpc_id                    = var.vpc_id
}
