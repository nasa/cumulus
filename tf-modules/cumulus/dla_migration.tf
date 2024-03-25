module "dla-migration-lambda" {
  source = "../../lambdas/dla-migration"

  prefix = var.prefix

  system_bucket = var.system_bucket

  lambda_subnet_ids = var.lambda_subnet_ids
  security_group_ids = [
    aws_security_group.no_ingress_all_egress[0].id
  ]

  tags = var.tags

  lambda_processing_role_arn = var.lambda_processing_role_arn
  lambda_timeouts       = var.lambda_timeouts
  lambda_memory_sizes   = var.lambda_memory_sizes
}

