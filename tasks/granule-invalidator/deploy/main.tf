locals {
  build_config = jsondecode(file("${path.module}/../build-config.json"))
}

module "granule_invalidator_task" {
  source = "../../../tf-modules/cumulus-task"

  name               = "GranuleInvalidator"
  prefix             = var.prefix
  role               = var.lambda_processing_role_arn
  lambda_zip_path    = "${path.module}/../dist/final/lambda.zip"
  subnet_ids         = var.lambda_subnet_ids
  security_group_id  = var.security_group_id
  timeout            = var.lambda_timeout
  memory_size        = var.lambda_memory_size
  architecture       = local.build_config.architecture
  log_retention_days = var.log_retention_days
  layers             = [var.cumulus_message_adapter_lambda_layer_version_arn]
  environment = {
    PRIVATE_API_LAMBDA_ARN = var.private_api_lambda_arn
  }

  tags = var.tags
}
