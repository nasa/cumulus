module "add_input_granules_task" {
  source = "../../../tf-modules/cumulus-task"

  name               = "AddInputGranules"
  prefix             = var.prefix
  role               = var.lambda_processing_role_arn
  lambda_zip_path    = "${path.module}/../dist/final/lambda.zip"
  subnet_ids         = var.lambda_subnet_ids
  security_group_id  = var.lambda_security_group_id
  timeout            = var.lambda_timeout
  memory_size        = var.lambda_memory_size
  runtime            = "python3.12"
  log_retention_days = var.log_retention_days

  tags = var.tags
}
