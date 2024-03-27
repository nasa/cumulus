module "dla_migration_lambda" {
  source = "../../lambdas/dla-migration"

  prefix              = var.prefix
  system_bucket       = var.system_bucket

  lambda_subnet_ids   = var.lambda_subnet_ids
  lambda_timeouts     = var.lambda_timeouts
  lambda_memory_sizes = var.lambda_memory_sizes

  tags                = var.tags
  vpc_id              = var.vpc_id
}

