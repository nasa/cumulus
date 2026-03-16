locals {
  task_root          = "${path.module}/../../tasks"
  zip_subdir         = "dist/final/lambda.zip"
  aws_api_proxy_name = "AwsApiProxy"
  security_group_id  = length(var.lambda_subnet_ids) > 0 ? aws_security_group.no_ingress_all_egress[0].id : ""
}

module "aws_api_proxy" {
  source = "../../tasks/aws-api-proxy/deploy"

  prefix                     = var.prefix
  lambda_processing_role_arn = var.lambda_processing_role_arn
  lambda_timeout             = lookup(var.lambda_timeouts, local.aws_api_proxy_name, 60)
  lambda_memory_size         = lookup(var.lambda_memory_sizes, local.aws_api_proxy_name, 512)
  security_group_id          = local.security_group_id
  log_retention_days         = var.default_log_retention_days

  tags = var.tags
}

module "get_cnm" {
  source                         = "../../tasks/get-cnm/deploy"
  prefix                         = var.prefix
  lambda_processing_role_arn     = var.lambda_processing_role_arn
  security_group_id              = local.security_group_id
  lambda_timeout                 = lookup(var.lambda_timeouts, "get-cnm-task", 60)
  lambda_memory_size             = lookup(var.lambda_memory_sizes, "get-cnm-task", 512)
  tags                           = var.tags
  private_api_lambda_arn         = var.private_api_lambda_arn
}

module add_input_granules_task {
  source = "../../tasks/add-input-granules/deploy"

  prefix                                           = var.prefix
  log_retention_days                               = var.default_log_retention_days
  lambda_processing_role_arn                       = var.lambda_processing_role_arn
  lambda_timeout                                   = lookup(var.lambda_timeouts, "AddInputGranules", 300)
  lambda_memory_size                               = lookup(var.lambda_memory_sizes, "AddInputGranules", 512)
  lambda_subnet_ids                                = var.lambda_subnet_ids
  lambda_security_group_id                         = length(var.lambda_subnet_ids) > 0 ? aws_security_group.no_ingress_all_egress[0].id : ""
  cumulus_message_adapter_lambda_layer_version_arn = var.cumulus_message_adapter_lambda_layer_version_arn
  private_api_lambda_arn                           = var.private_api_lambda_arn

  tags = var.tags
}
