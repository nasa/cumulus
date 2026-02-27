module "cnm_to_cma_task" {
  source = "../../../tf-modules/cumulus-task"

  name               = "CnmToCma"
  prefix             = var.prefix
  role               = var.lambda_processing_role_arn
  lambda_zip_path    = "${path.module}/../dist/final/lambda.zip"
  subnet_ids         = var.lambda_subnet_ids
  security_group_id  = var.security_group_id
  timeout            = var.lambda_timeout
  memory_size        = var.lambda_memory_size
  log_retention_days = var.log_retention_days

  tags = var.tags
}
