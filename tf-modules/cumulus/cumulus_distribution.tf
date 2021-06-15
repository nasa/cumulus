// TODO probably not necessary because we have this in example
# module "cumulus_distribution" {
#   source = "../cumulus_distribution"
#   deploy_to_ngap        = var.deploy_to_ngap
#   prefix                = var.prefix
#   oauth_client_id       = var.oauth_client_id
#   oauth_client_password = var.oauth_client_password
#   oauth_host_url        = var.oauth_host_url

# # TODO optional vars::
# #   api_url                               = var.api_url
# #   api_gateway_stage                     = var.api_gateway_stage
# #   cmr_acl_based_credentials             = var.cmr_acl_based_credentials
# #   cmr_environment                       = var.cmr_environment
# #   cmr_provider                          = var.cmr_provider
# #   lambda_subnet_ids                     = var.lambda_subnet_ids
# #   oauth_provider                        = var.oauth_provider
# #   permissions_boundary_arn              = var.permissions_boundary_arn
# #   sts_credentials_lambda_function_arn   = var.sts_credentials_lambda_function_arn
# #   sts_policy_helper_lambda_function_arn = var.sts_policy_helper_lambda_function_arn
# #   protected_buckets                     = local.protected_bucket_names
# #   public_buckets                        = local.public_bucket_names
# #   vpc_id                                = var.vpc_id

#   tags = var.tags
# }
