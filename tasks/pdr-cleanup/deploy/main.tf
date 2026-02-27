resource "aws_lambda_function" "pdr_cleanup_task" {
  function_name    = "${var.prefix}-PdrCleanup"
  filename         = "${path.module}/../dist/final/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../dist/final/lambda.zip")
  handler          = "pdr_cleanup.task.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "python3.12"
  timeout          = var.lambda_timeout
  memory_size      = var.lambda_memory_size

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

resource "aws_cloudwatch_log_group" "pdr_cleanup_task" {
  name              = "/aws/lambda/${aws_lambda_function.pdr_cleanup_task.function_name}"
  retention_in_days = var.default_log_retention_days
  tags              = var.tags
}
