resource "aws_lambda_function" "pdr_cleanup_task" {
  function_name    = "${var.prefix}-PdrCleanup"
  filename         = "${path.module}/../dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../dist/lambda.zip")
  handler          = "pdr_cleanup.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "python3.13"
  timeout          = 300
  memory_size      = 512

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
      security_group_ids = [var.lambda_security_group_id]
    }
  }

  tags = var.tags
}