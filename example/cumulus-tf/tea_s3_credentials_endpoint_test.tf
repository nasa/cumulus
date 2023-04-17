module "tea_s3_credentials_endpoint_test" {
  source = "../../tf-modules/distribution"

  tea_api_gateway_stage         = local.tea_stage_name
  tea_external_api_endpoint     = module.thin_egress_app.api_endpoint
  tea_internal_api_endpoint     = module.thin_egress_app.internal_api_endpoint
  tea_rest_api_id               = module.thin_egress_app.rest_api.id
  tea_rest_api_root_resource_id = module.thin_egress_app.rest_api.root_resource_id

  cmr_environment                                = var.cmr_environment
  cmr_provider                                   = var.cmr_provider
  deploy_s3_credentials_endpoint                 = true 
  deploy_to_ngap                                 = true
  lambda_processing_role_arn                     = module.cumulus.lambda_processing_role_arn 
  log_destination_arn                            = var.log_destination_arn
  permissions_boundary_arn                       = var.permissions_boundary_arn
  prefix                                         = var.prefix
  protected_buckets                              = local.protected_bucket_names
  public_buckets                                 = local.public_bucket_names
  sts_credentials_lambda_function_arn            = data.aws_lambda_function.sts_credentials.arn
  sts_policy_helper_lambda_function_arn          = data.aws_lambda_function.sts_policy_helper.arn 
  subnet_ids                                     = local.subnet_ids
  system_bucket                                  = var.system_bucket
  urs_client_id                                  = var.urs_client_id
  urs_client_password                            = var.urs_client_password
  urs_url                                        = "https://uat.urs.earthdata.nasa.gov" 
  cmr_acl_based_credentials                      = true 
  vpc_id                                         = local.vpc_id

  default_log_retention_days                     = var.default_log_retention_days
  cloudwatch_log_retention_periods               = var.cloudwatch_log_retention_periods

  tags = local.tags
}
