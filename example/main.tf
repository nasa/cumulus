locals {
  permissions_boundary_name = var.permissions_boundary == null ? null : reverse(split("/", var.permissions_boundary))[0]
}

provider "aws" {
  region = var.region
}

module "thin_egress_app" {
  # source = "https://s3.amazonaws.com/asf.public.code/thin-egress-app/tea-terraform-build.16.zip"
  source = "../../thin-egress-app/terraform"

  auth_base_url              = "https://uat.urs.earthdata.nasa.gov"
  bucket_map_file            = var.tea_bucket_map_file
  bucketname_prefix          = ""
  config_bucket              = var.tea_config_bucket
  domain_name                = var.tea_domain_name
  lambda_code_s3_key         = "thin-egress-app/tea-code-build.16.zip"
  permissions_boundary_name  = local.permissions_boundary_name
  private_vpc                = var.vpc_id
  stack_name                 = var.tea_stack_name
  stage_name                 = var.tea_stage_name
  template_body              = file("${path.module}/../../thin-egress-app/cloudformation/thin-egress-app.yaml")
  vpc_subnet_ids             = var.tea_subnet_ids
  urs_auth_creds_secret_name = var.tea_urs_auth_creds_secret_name
}

module "s3_credentials_endpoint" {
  source = "../packages/s3-credentials-endpoint"

  prefix               = var.prefix
  permissions_boundary = var.permissions_boundary
  subnet_ids           = var.tea_subnet_ids
  ngap_sgs             = var.ngap_sgs

  rest_api   = module.thin_egress_app.rest_api
  stage_name = module.thin_egress_app.rest_api_stage_name

  sts_credentials_lambda_arn = var.sts_credentials_lambda_arn

  urs_client_id       = var.urs_client_id
  urs_client_password = var.urs_client_password
  urs_url             = var.urs_url
}
