resource "aws_lambda_function" "sync_granule_task" {
  function_name    = "${var.prefix}-SyncGranule"
  filename         = "${path.module}/../../tasks/sync-granule/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../tasks/sync-granule/dist/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs10.x"
  timeout          = 300
  memory_size      = 1024

  layers = [var.cumulus_message_adapter_lambda_layer_arn]

  environment {
    variables = {
      CMR_ENVIRONMENT             = var.cmr_environment
      stackName                   = var.prefix
      system_bucket               = var.system_bucket
      CUMULUS_MESSAGE_ADAPTER_DIR = "/opt/"
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

resource "aws_cloudwatch_log_group" "sync_granule_task" {
  name = "/aws/lambda/${aws_lambda_function.sync_granule_task.function_name}"
  retention_in_days = 30
  tags = var.tags
}
