module "cnm_response_task" {
  source = "../../tasks/cnm-response/deploy"

  default_log_retention_days = var.default_log_retention_days
  prefix                     = var.prefix
  lambda_processing_role_arn = var.lambda_processing_role_arn
  lambda_timeout             = lookup(var.lambda_timeouts, "CnmResponse", 300)
  lambda_memory_size         = lookup(var.lambda_memory_sizes, "CnmResponse", 512)
  lambda_subnet_ids          = var.lambda_subnet_ids
  security_group_id          = length(var.lambda_subnet_ids) > 0 ? aws_security_group.no_ingress_all_egress[0].id : ""
  tags                       = var.tags
}
