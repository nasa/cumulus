module "distribution" {
  source = "../distribution"

  api_gateway_stage                              = var.distribution_api_gateway_stage
  deploy_s3_credentials_endpoint                 = var.deploy_distribution_s3_credentials_endpoint
  distribution_url                               = var.distribution_url
  log_api_gateway_to_cloudwatch                  = var.log_api_gateway_to_cloudwatch
  log_destination_arn                            = var.log_destination_arn
  permissions_boundary_arn                       = var.permissions_boundary_arn
  prefix                                         = var.prefix
  protected_buckets                              = local.protected_bucket_names
  public_buckets                                 = local.public_bucket_names
  sts_credentials_lambda_function_arn            = var.sts_credentials_lambda_function_arn
  subnet_ids                                     = var.lambda_subnet_ids
  system_bucket                                  = var.system_bucket
  thin_egress_cookie_domain                      = var.thin_egress_cookie_domain
  thin_egress_domain_cert_arn                    = var.thin_egress_domain_cert_arn
  thin_egress_download_role_in_region_arn        = var.thin_egress_download_role_in_region_arn
  thin_egress_jwt_algo                           = var.thin_egress_jwt_algo
  thin_egress_jwt_secret_name                    = var.thin_egress_jwt_secret_name
  thin_egress_lambda_code_dependency_archive_key = var.thin_egress_lambda_code_dependency_archive_key
  urs_client_id                                  = var.urs_client_id
  urs_client_password                            = var.urs_client_password
  urs_url                                        = var.urs_url
  vpc_id                                         = var.vpc_id

  tags = var.tags
}
