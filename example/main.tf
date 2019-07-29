provider "aws" {
  region = var.region
  profile = var.aws_profile
}

module "cumulus" {
  source = "../"

  distribution_url         = var.distribution_url
  permissions_boundary_arn = var.permissions_boundary_arn
  prefix                   = var.prefix
  protected_buckets        = var.protected_buckets
  public_buckets           = var.public_buckets
  region                   = var.region
  subnet_ids               = var.subnet_ids
  system_bucket            = var.system_bucket
  urs_client_id            = var.urs_client_id
  urs_client_password      = var.urs_client_password
  urs_url                  = "https://uat.urs.earthdata.nasa.gov"
  vpc_id                   = var.vpc_id
}
