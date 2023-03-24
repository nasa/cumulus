resource "aws_lambda_function" "update_granules_cmr_metadata_file_links_task" {
  depends_on       = [aws_cloudwatch_log_group.UpdateGranulesCmrMetadataFileLinks]
  function_name    = "${var.prefix}-UpdateGranulesCmrMetadataFileLinks"
  filename         = "${path.module}/../../tasks/update-granules-cmr-metadata-file-links/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../tasks/update-granules-cmr-metadata-file-links/dist/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs16.x"
  timeout          = lookup(var.lambda_timeouts, "update_granules_cmr_metadata_file_links_task_timeout", 300)
  memory_size      = lookup(var.lambda_memory_sizes, "update_granules_cmr_metadata_file_links_task_memory_size", 1024)

  layers = [var.cumulus_message_adapter_lambda_layer_version_arn]

  environment {
    variables = {
      CMR_ENVIRONMENT             = var.cmr_environment
      CMR_HOST                    = var.cmr_custom_host
      stackName                   = var.prefix
      CUMULUS_MESSAGE_ADAPTER_DIR = "/opt/"
      system_bucket               = var.system_bucket
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [
        aws_security_group.no_ingress_all_egress[0].id
      ]
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "update_granules_cmr_metadata_file_links_task" {
  name = "/aws/lambda/${var.prefix}-UpdateGranulesCmrMetadataFileLinks"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "UpdateGranulesCmrMetadataFileLinks", var.default_log_retention_days)
  tags = var.tags
}
