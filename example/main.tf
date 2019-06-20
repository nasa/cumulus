provider "aws" {
  region = var.region
}

module "thin_egress_app" {
  source = "https://s3.amazonaws.com/asf.public.code/thin-egress-app/tea-terraform-build.16.zip"

  auth_base_url              = "https://uat.urs.earthdata.nasa.gov"
  bucketname_prefix          = ""
  config_bucket              = var.tea_config_bucket
  domain_name                = var.tea_domain_name
  permissions_boundary_name  = var.permissions_boundary_name
  private_vpc                = var.vpc_id
  stack_name                 = var.tea_stack_name
  stage_name                 = var.tea_stage_name
  vpc_subnet_ids             = var.tea_subnet_ids
  urs_auth_creds_secret_name = var.tea_urs_auth_creds_secret_name
}
