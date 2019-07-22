provider "aws" {
  region = var.region
}

module "cumulus" {
  prefix = var.prefix

  permissions_boundary        = var.permissions_boundary
  protected_buckets           = var.protected_buckets
  public_buckets              = var.public_buckets
  region                      = var.region
  source                      = "../"
  subnet_ids                  = var.subnet_ids
  system_bucket               = var.system_bucket
  thin_egress_app_domain_name = var.thin_egress_app_domain_name
  urs_client_id               = var.urs_client_id
  urs_client_password         = var.urs_client_password
  urs_url                     = "https://uat.urs.earthdata.nasa.gov"
  vpc_id                      = var.vpc_id
}
