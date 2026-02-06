locals {
  build_config = jsondecode(file("${path.module}/../build-config.json"))
}

resource "aws_lambda_function" "granule_invalidator_task" {
  function_name    = "${var.prefix}-granule-invalidator-task"
  filename         = "${path.module}/../dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../dist/lambda.zip")
  handler          = "main.handler"
  role             = var.role
  runtime          = local.build_config.runtime
  architectures    = [local.build_config.architecture]
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

resource "aws_cloudwatch_log_group" "granule_invalidator_task" {
  name              = "/aws/lambda/${aws_lambda_function.granule_invalidator_task.function_name}"
  retention_in_days = var.default_log_retention_days
  tags              = var.tags
}
