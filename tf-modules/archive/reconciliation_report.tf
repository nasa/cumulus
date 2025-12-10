# CreateReconciliationReport

resource "aws_lambda_function" "create_reconciliation_report" {
  function_name    = "${var.prefix}-CreateReconciliationReport"
  filename         = "${path.module}/../../packages/api/dist/createReconciliationReport/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/createReconciliationReport/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs22.x"
  timeout          = lookup(var.lambda_timeouts, "CreateReconciliationReport", 300)
  memory_size      = lookup(var.lambda_memory_sizes, "CreateReconciliationReport", 512)
  environment {
    variables = {
      CMR_ENVIRONMENT                  = var.cmr_environment
      CMR_HOST                         = var.cmr_custom_host
      DISTRIBUTION_ENDPOINT            = var.distribution_url
      stackName                        = var.prefix
      system_bucket                    = var.system_bucket
      cmr_client_id                    = var.cmr_client_id
      cmr_oauth_provider               = var.cmr_oauth_provider
      cmr_provider                     = var.cmr_provider
      cmr_username                     = var.cmr_username
      cmr_password_secret_name         = length(var.cmr_password) == 0 ? null : aws_secretsmanager_secret.api_cmr_password.name
      CMR_LIMIT                        = lookup(var.cmr_search_client_config, "create_reconciliation_report_cmr_limit", 5000)
      CMR_PAGE_SIZE                    = lookup(var.cmr_search_client_config, "create_reconciliation_report_cmr_page_size", 200)
      launchpad_api                    = var.launchpad_api
      launchpad_certificate            = var.launchpad_certificate
      launchpad_passphrase_secret_name = length(var.launchpad_passphrase) == 0 ? null : aws_secretsmanager_secret.api_launchpad_passphrase.name
      orca_api_uri                     = var.orca_api_uri
    }
  }
  tags = var.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = concat(local.lambda_security_group_ids, [var.rds_security_group])
    }
  }
}
