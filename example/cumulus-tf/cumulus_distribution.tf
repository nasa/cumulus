locals {
  distribution_api_gateway_stage = "dev"
}

module "cumulus_distribution" {
  source                   = "../../tf-modules/cumulus_distribution"
  deploy_to_ngap           = true
  prefix                   = var.prefix
  api_gateway_stage        = local.distribution_api_gateway_stage
  api_url                  = var.cumulus_distribution_url
  lambda_subnet_ids        = var.lambda_subnet_ids
  oauth_client_id          = var.csdap_client_id
  oauth_client_password    = var.csdap_client_password
  oauth_host_url           = var.csdap_host_url
  oauth_provider           = "cognito"
  permissions_boundary_arn = var.permissions_boundary_arn
  protected_buckets        = local.protected_bucket_names
  public_buckets           = local.public_bucket_names
  tags                     = local.tags
  vpc_id                   = var.vpc_id
}
