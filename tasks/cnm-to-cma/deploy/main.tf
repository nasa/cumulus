resource "aws_lambda_function" "cnm_to_cma_task" {
  function_name    = "${var.prefix}-CNMToCMA"
  filename         = "${path.module}/../dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../dist/lambda.zip")
  handler          = "cnm_to_cma.cnm_to_cma.handler"
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
      subnet_ids         = var.lambda_subnet_ids
      security_group_ids = [var.security_group_id]
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "cnm_to_cma_task" {
  name              = "/aws/lambda/${aws_lambda_function.cnm_to_cma_task.function_name}"
  retention_in_days = var.default_log_retention_days
  tags              = var.tags
}
