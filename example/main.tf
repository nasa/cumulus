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

  protected_buckets = var.protected_buckets
  public_buckets    = var.public_buckets

  urs_url             = "https://uat.urs.earthdata.nasa.gov"
  urs_client_id       = var.urs_client_id
  urs_client_password = var.urs_client_password

  vpc_id     = var.vpc_id
  subnet_ids = var.subnet_ids
}

module "s3-replicator" {
  # count  = var.s3_access_log_replication == true ? 1 : 0
  source = "../tf-modules/s3-replicator"

  prefix               = var.prefix
  permissions_boundary = var.permissions_boundary_arn

  vpc_id          = var.vpc_id
  subnet_ids      = var.subnet_ids

  source_bucket = "cumulus-sandbox-testing"
  source_prefix = "cross-account-replication-testing/files"
  target_bucket = "esdis-metrics-shared-data-sandbox"
  target_prefix = "cross-account-replication-testing/files"
}
