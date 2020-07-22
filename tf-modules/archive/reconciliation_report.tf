# CreateReconciliationReport

resource "aws_lambda_function" "create_reconciliation_report" {
  function_name    = "${var.prefix}-CreateReconciliationReport"
  filename         = "${path.module}/../../packages/api/dist/createReconciliationReport/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/createReconciliationReport/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs12.x"
  timeout          = 300
  memory_size      = 256
  environment {
    variables = {
      CMR_ENVIRONMENT                  = var.cmr_environment
      CollectionsTable                 = var.dynamo_tables.collections.name
      DISTRIBUTION_ENDPOINT            = var.distribution_url
      ES_HOST                          = var.elasticsearch_hostname
      FilesTable                       = var.dynamo_tables.files.name
      GranulesTable                    = var.dynamo_tables.granules.name
      ReconciliationReportsTable       = var.dynamo_tables.reconciliation_reports.name
      stackName                        = var.prefix
      system_bucket                    = var.system_bucket
      cmr_client_id                    = var.cmr_client_id
      cmr_provider                     = var.cmr_provider
      cmr_username                     = var.cmr_username
      cmr_password_secret_name         = length(var.cmr_password) == 0 ? null : aws_secretsmanager_secret.api_cmr_password.name
      CMR_LIMIT                        = var.cmr_limit
      CMR_PAGE_SIZE                    = var.cmr_page_size
      launchpad_api                    = var.launchpad_api
      launchpad_certificate            = var.launchpad_certificate
      launchpad_passphrase_secret_name = length(var.launchpad_passphrase) == 0 ? null : aws_secretsmanager_secret.api_launchpad_passphrase.name
    }
  }
  tags = var.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = local.lambda_security_group_ids
    }
  }
}
