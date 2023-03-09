locals {
  distribution_api_gateway_stage = "dev"
  bucket_map_file_name = fileexists("${path.module}/cumulus_distribution/bucket_map.yaml") ? "${path.module}/cumulus_distribution/bucket_map.yaml" : "${path.module}/cumulus_distribution/bucket_map.yaml.tmpl"
}

resource "aws_s3_bucket_object" "bucket_map_yaml_distribution" {
  bucket  = var.system_bucket
  key     = "${var.prefix}/cumulus_distribution/bucket_map.yaml"
  content = templatefile(local.bucket_map_file_name, {
    protected_buckets = local.protected_bucket_names,
    public_buckets = local.public_bucket_names
  })
  etag    = md5(templatefile(local.bucket_map_file_name, {
    protected_buckets = local.protected_bucket_names,
    public_buckets = local.public_bucket_names
  }))
  tags    = var.tags
}

module "cumulus_distribution" {
  source                   = "../../tf-modules/cumulus_distribution"
  deploy_to_ngap           = true
  prefix                   = var.prefix
  api_gateway_stage        = local.distribution_api_gateway_stage
  api_url                  = var.cumulus_distribution_url
  bucket_map_file          = aws_s3_bucket_object.bucket_map_yaml_distribution.id
  bucketname_prefix        = ""
  cmr_acl_based_credentials = true
  cmr_environment           = var.cmr_environment
  cmr_provider              = var.cmr_provider
  lambda_subnet_ids        = local.subnet_ids
  oauth_client_id          = var.csdap_client_id
  oauth_client_password    = var.csdap_client_password
  oauth_host_url           = var.csdap_host_url
  oauth_provider           = "cognito"
  permissions_boundary_arn = var.permissions_boundary_arn
  buckets                  = var.buckets
  sts_credentials_lambda_function_arn = data.aws_lambda_function.sts_credentials.arn
  sts_policy_helper_lambda_function_arn = data.aws_lambda_function.sts_policy_helper.arn
  system_bucket            = var.system_bucket
  tags                     = local.tags
  vpc_id                   = local.vpc_id

  cloudwatch_log_retention_periods = var.cloudwatch_log_retention_periods
}
