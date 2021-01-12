module "distribution" {
  source = "../distribution"

  prefix = var.prefix

  tea_internal_api_endpoint = var.tea_internal_api_endpoint

  lambda_processing_role_arn = aws_iam_role.lambda_processing.arn

  permissions_boundary_arn = var.permissions_boundary_arn

  protected_buckets = local.protected_bucket_names
  public_buckets    = local.public_bucket_names
  system_bucket     = var.system_bucket

  lambda_subnet_ids = var.lambda_subnet_ids
  vpc_id            = var.vpc_id

  deploy_to_ngap = var.deploy_to_ngap

  tags = var.tags
}
