module "distribution" {
  source = "../distribution"

  # tea_stack_name = var.tea_stack_name
  # tea_rest_api_id = data.aws_cloudformation_stack.tea_stack.outputs["RestApiId"]
  # tea_rest_api_root_resource_id = data.aws_cloudformation_stack.tea_stack.outputs["RestApiRootResourceId"]
  # tea_internal_api_endpoint = data.aws_cloudformation_stack.tea_stack.outputs["ApiEndpoint"]
  # tea_egress_log_group = lookup(data.aws_cloudformation_stack.tea_stack.outputs, "ApiGatewayLogGroupEgress", null)

  tea_rest_api_id = var.tea_rest_api_id
  tea_rest_api_root_resource_id = var.tea_rest_api_root_resource_id
  tea_internal_api_endpoint = var.tea_internal_api_endpoint
  tea_egress_log_group = var.tea_egress_log_group

  api_gateway_stage                              = var.distribution_api_gateway_stage
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
  urs_client_id                                  = var.urs_client_id
  urs_client_password                            = var.urs_client_password
  urs_url                                        = var.urs_url
  vpc_id                                         = var.vpc_id

  tags = var.tags
}
