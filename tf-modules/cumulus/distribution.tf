module "distribution" {
  source = "../distribution"

  tea_rest_api_id = data.aws_cloudformation_stack.tea_stack.outputs["RestApiId"]
  tea_rest_api_root_resource_id = data.aws_cloudformation_stack.tea_stack.outputs["RestApiRootResourceId"]
  tea_internal_api_endpoint = data.aws_cloudformation_stack.tea_stack.outputs["ApiEndpoint"]
  tea_egress_log_group = data.aws_cloudformation_stack.tea_stack.outputs["ApiGatewayLogGroupEgress"]

  api_gateway_stage                              = var.distribution_api_gateway_stage
  bucket_map_key                                 = var.bucket_map_key
  deploy_s3_credentials_endpoint                 = var.deploy_distribution_s3_credentials_endpoint
  lambda_processing_role_arn                     = aws_iam_role.lambda_processing.arn
  log_destination_arn                            = var.log_destination_arn
  permissions_boundary_arn                       = var.permissions_boundary_arn
  prefix                                         = var.prefix
  protected_buckets                              = local.protected_bucket_names
  public_buckets                                 = local.public_bucket_names
  sts_credentials_lambda_function_arn            = var.sts_credentials_lambda_function_arn
  subnet_ids                                     = var.lambda_subnet_ids
  system_bucket                                  = var.system_bucket
  urs_url                                        = var.urs_url
  vpc_id                                         = var.vpc_id

  tags = var.tags
}
