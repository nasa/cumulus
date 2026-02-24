terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.100, < 6.0.0"
    }
  }
}

resource "aws_lambda_function" "cumulus_task_lambda" {
  function_name    = "${var.prefix}-${var.name}"
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = var.handler
  role             = var.role
  runtime          = var.runtime
  architectures    = [var.architecture]
  timeout          = var.timeout
  memory_size      = var.memory_size

  layers = var.layers

  environment {
    variables = merge(
      {
        stackName                   = var.prefix
        CUMULUS_MESSAGE_ADAPTER_DIR = "/opt/"
      },
      var.environment
    )
  }

  dynamic "vpc_config" {
    for_each = length(var.subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids         = var.subnet_ids
      security_group_ids = [var.security_group_id]
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "cumulus_task_log_group" {
  name              = "/aws/lambda/${aws_lambda_function.cumulus_task_lambda.function_name}"
  retention_in_days = var.default_log_retention_days
  tags              = var.tags
}
