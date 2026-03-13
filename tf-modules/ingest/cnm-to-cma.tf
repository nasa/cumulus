module "cnm_to_cma_task" {
  source                     = "../../tasks/cnm-to-cma/deploy"

  prefix                     = var.prefix
  lambda_processing_role_arn = var.lambda_processing_role_arn
  lambda_timeout             = lookup(var.lambda_timeouts, "CnmToCma", 60 * 3)
  lambda_memory_size         = lookup(var.lambda_memory_sizes, "CnmToCma", 512)
  lambda_subnet_ids          = var.lambda_subnet_ids
  security_group_id          = length(var.lambda_subnet_ids) > 0 ? aws_security_group.no_ingress_all_egress[0].id : ""
  log_retention_days         = var.default_log_retention_days

  tags = var.tags
}
