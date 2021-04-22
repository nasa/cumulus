locals {
  distribution_api_gateway_stage = "dev"
}

module "distribution" {
  source                   = "../../tf-modules/distribution"
  deploy_to_ngap           = true
  prefix                   = var.prefix
  api_gateway_stage        = local.distribution_api_gateway_stage
  lambda_subnet_ids        = var.lambda_subnet_ids
  permissions_boundary_arn = var.permissions_boundary_arn
  tags                     = local.tags
  vpc_id                   = var.vpc_id
}
