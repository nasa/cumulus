locals {
  distribution_api_gateway_stage = "dev"
  bucket_map_file_name = fileexists("${path.module}/cumulus_distribution/bucket_map.yaml") ? "${path.module}/cumulus_distribution/bucket_map.yaml" : "${path.module}/cumulus_distribution/bucket_map.yaml.tmpl"
}

resource "aws_s3_bucket_object" "bucket_map_yaml_file" {
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
  bucket_map_file          = aws_s3_bucket_object.bucket_map_yaml.id
  bucketname_prefix        = ""
  config_bucket            = var.system_bucket
  lambda_subnet_ids        = var.lambda_subnet_ids
  oauth_client_id          = var.csdap_client_id
  oauth_client_password    = var.csdap_client_password
  oauth_host_url           = var.csdap_host_url
  oauth_provider           = "cognito"
  cmr_acl_based_credentials = true
  cmr_environment           = var.cmr_environment
  cmr_provider              = var.cmr_provider
  permissions_boundary_arn = var.permissions_boundary_arn
  protected_buckets        = local.protected_bucket_names
  public_buckets           = local.public_bucket_names
  sts_credentials_lambda_function_arn = data.aws_lambda_function.sts_credentials.arn
  sts_policy_helper_lambda_function_arn = data.aws_lambda_function.sts_policy_helper.arn
  tags                     = local.tags
  vpc_id                   = var.vpc_id
}
