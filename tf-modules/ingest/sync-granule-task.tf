resource "aws_lambda_function" "sync_granule_task" {
  depends_on       = [aws_cloudwatch_log_group.sync_granule_task]
  function_name    = "${var.prefix}-SyncGranule"
  filename         = "${path.module}/../../tasks/sync-granule/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../tasks/sync-granule/dist/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs22.x"
  timeout          = lookup(var.lambda_timeouts, "SyncGranule", 300)
  memory_size      = lookup(var.lambda_memory_sizes, "SyncGranule", 1024)

  layers = [var.cumulus_message_adapter_lambda_layer_version_arn]

  environment {
    variables = {
      stackName                   = var.prefix
      system_bucket               = var.system_bucket
      CUMULUS_MESSAGE_ADAPTER_DIR = "/opt/"
      S3_JITTER_MAX_MS            = var.sync_granule_s3_jitter_max_ms
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
  name = "/aws/lambda/${var.prefix}-SyncGranule"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "SyncGranule", var.default_log_retention_days)
  tags = var.tags
}
