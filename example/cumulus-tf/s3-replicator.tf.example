module "s3-replicator" {
  source = "../../tf-modules/s3-replicator"
  prefix               = var.prefix
  vpc_id               = var.vpc_id
  subnet_ids           = var.lambda_subnet_ids
  permissions_boundary = var.permissions_boundary_arn
  source_bucket        = var.s3_replicator_config.source_bucket
  source_prefix        = var.s3_replicator_config.source_prefix
  target_bucket        = var.s3_replicator_config.target_bucket
  target_prefix        = var.s3_replicator_config.target_prefix
  target_region        = var.s3_replicator_config.target_region
}
