module "distribution" {
  source = "../distribution"

  deploy_s3_credentials_endpoint      = var.deploy_distribution_s3_credentials_endpoint
  api_gateway_stage                   = var.distribution_api_gateway_stage
  distribution_url                    = var.distribution_url
  log_api_gateway_to_cloudwatch       = var.log_api_gateway_to_cloudwatch
  log_destination_arn                 = var.log_destination_arn
  permissions_boundary_arn            = var.permissions_boundary_arn
  prefix                              = var.prefix
  protected_buckets                   = local.protected_bucket_names
  public_buckets                      = local.public_bucket_names
  sts_credentials_lambda_function_arn = var.sts_credentials_lambda_function_arn
  subnet_ids                          = var.lambda_subnet_ids
  system_bucket                       = var.system_bucket
  urs_client_id                       = var.urs_client_id
  urs_client_password                 = var.urs_client_password
  urs_url                             = var.urs_url
  vpc_id                              = var.vpc_id
}
