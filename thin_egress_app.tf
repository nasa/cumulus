resource "aws_s3_bucket_object" "bucket_map_yaml" {
  bucket  = var.system_bucket
  key     = "${var.prefix}/thin-egress-app/bucket_map.yaml"
  content = templatefile("${path.module}/bucket_map.yaml.tmpl", { protected_buckets = var.protected_buckets, public_buckets = var.public_buckets })
  etag    = md5(templatefile("${path.module}/bucket_map.yaml.tmpl", { protected_buckets = var.protected_buckets, public_buckets = var.public_buckets }))
}

resource "aws_secretsmanager_secret" "thin_egress_urs_creds" {
  name        = "${var.prefix}-tea-urs-creds"
  description = "URS credentials for the ${var.prefix} Thin Egress App"
}

resource "aws_secretsmanager_secret_version" "thin_egress_urs_creds" {
  secret_id     = aws_secretsmanager_secret.thin_egress_urs_creds.id
  secret_string = "{\"UrsId\": \"${var.urs_client_id}=\",\"UrsAuth\": \"${base64encode("${var.urs_client_id}:${var.urs_client_password}")}\"}"
}

module "thin_egress_app" {
  source = "https://s3.amazonaws.com/asf.public.code/thin-egress-app/tea-terraform-build.18.zip"

  auth_base_url              = var.urs_url
  bucket_map_file            = aws_s3_bucket_object.bucket_map_yaml.key
  bucketname_prefix          = ""
  config_bucket              = var.system_bucket
  domain_name                = var.thin_egress_app_domain_name
  permissions_boundary_name  = var.permissions_boundary == null ? null : reverse(split("/", var.permissions_boundary))[0]
  private_vpc                = var.vpc_id
  stack_name                 = "${var.prefix}-thin-egress-app"
  stage_name                 = var.thin_egress_app_deployment_stage
  vpc_subnet_ids             = var.subnet_ids
  urs_auth_creds_secret_name = aws_secretsmanager_secret.thin_egress_urs_creds.name
}

module "s3_credentials_endpoint" {
  source = "./packages/s3-credentials-endpoint"

  public_buckets       = var.public_buckets
  prefix               = var.prefix
  region               = var.region
  rest_api             = module.thin_egress_app.rest_api
  subnet_ids           = var.subnet_ids
  urs_url              = var.urs_url
  urs_client_id        = var.urs_client_id
  urs_client_password  = var.urs_client_password
  permissions_boundary = var.permissions_boundary
  stage_name           = var.thin_egress_app_deployment_stage
  vpc_id               = var.vpc_id
}
