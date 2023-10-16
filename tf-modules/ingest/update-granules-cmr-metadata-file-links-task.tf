resource "aws_lambda_function" "update_granules_cmr_metadata_file_links_task" {
  function_name    = "${var.prefix}-UpdateGranulesCmrMetadataFileLinks"
  filename         = "${path.module}/../../tasks/update-granules-cmr-metadata-file-links/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../tasks/update-granules-cmr-metadata-file-links/dist/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs16.x"
  timeout          = lookup(var.lambda_timeouts, "UpdateGranulesCmrMetadataFileLinks", 300)
  memory_size      = lookup(var.lambda_memory_sizes, "UpdateGranulesCmrMetadataFileLinks", 1024)

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
