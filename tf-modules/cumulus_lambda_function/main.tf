locals {
  default_tags = { Deployment = var.prefix }
}

resource "aws_lambda_function" "task" {
  function_name    = "${var.prefix}-${var.function_name}"
  filename         = var.filename
  source_code_hash = filebase64sha256(var.filename)
  handler          = var.handler
  role             = var.role
  runtime          = var.runtime
  timeout          = var.timeout
  memory_size      = var.memory_size

  layers = var.layers

  publish = var.enable_versioning

  dynamic "environment" {
    for_each = length(var.environment_variables) == 0 ? [] : [1]
    content {
      variables = var.environment_variables
    }
  }

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_group_ids
  }

  tags = merge(local.default_tags, var.tags)
}
