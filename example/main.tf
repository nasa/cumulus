provider "aws" {
  region = var.region
  profile = var.aws_profile
}

module "distribution" {
  source = "../tf-modules/distribution"

  prefix        = var.prefix
  system_bucket = var.system_bucket

  permissions_boundary_arn = var.permissions_boundary_arn

  distribution_url = var.distribution_url

  # Additional Logging Settings
  log_api_gateway_to_cloudwatch = var.log_api_gateway_to_cloudwatch
  log_to_shared_destination     = var.log_to_shared_destination
  log_destination_arn           = var.log_destination_arn

  protected_buckets = var.protected_buckets
  public_buckets    = var.public_buckets

  urs_url             = "https://uat.urs.earthdata.nasa.gov"
  urs_client_id       = var.urs_client_id
  urs_client_password = var.urs_client_password

  vpc_id     = var.vpc_id
  subnet_ids = var.subnet_ids
}

module "s3-replicator" {
  source = "../tf-modules/s3-replicator"

  prefix               = var.prefix
  permissions_boundary = var.permissions_boundary_arn

  vpc_id     = var.vpc_id
  subnet_ids = var.subnet_ids

  source_bucket = "cumulus-sandbox-testing"
  source_prefix = "cross-account-replication-testing/files"
  target_bucket = "esdis-metrics-shared-data-sandbox"
  target_prefix = "cross-account-replication-testing/files"
}
