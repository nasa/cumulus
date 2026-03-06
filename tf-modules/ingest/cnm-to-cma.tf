module "granule_invalidator_task" {
  source                     = "../../tasks/cnm-to-cma/deploy"
  prefix                     = var.prefix
  role                       = var.lambda_processing_role_arn
  layers                     = [var.cumulus_message_adapter_lambda_layer_version_arn]
  subnet_ids                 = var.lambda_subnet_ids
  security_group_id          = length(var.lambda_subnet_ids) > 0 ? aws_security_group.no_ingress_all_egress[0].id : ""
  timeout                    = lookup(var.lambda_timeouts, "CnmToCma", 60 * 3)
  memory_size                = lookup(var.lambda_memory_sizes, "CnmToCma", 512)
  default_log_retention_days = var.default_log_retention_days
  private_api_lambda_arn     = var.private_api_lambda_arn
  tags                       = var.tags
}
