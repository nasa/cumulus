resource "aws_lambda_function" "queue_pdrs_task" {
  depends_on       = [aws_cloudwatch_log_group.queue_pdrs_task]
  function_name    = "${var.prefix}-QueuePdrs"
  filename         = "${path.module}/../../tasks/queue-pdrs/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../tasks/queue-pdrs/dist/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs16.x"
  timeout          = lookup(var.lambda_timeouts, "QueuePdrs", 300)
  memory_size      = lookup(var.lambda_memory_sizes, "QueuePdrs", 1024)

  layers = [var.cumulus_message_adapter_lambda_layer_version_arn]

  environment {
    variables = {
      stackName                   = var.prefix
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

resource "aws_cloudwatch_log_group" "queue_pdrs_task" {
  name              = "/aws/lambda/${var.prefix}-QueuePdrs"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "QueuePdrs", var.default_log_retention_days)
  tags              = var.tags
}
