resource "aws_lambda_function" "custom_bootstrap" {
  function_name    = "${var.prefix}-CustomBootstrap"
  filename         = "${path.module}/../../packages/api/dist/bootstrap/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/bootstrap/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs10.x"
  timeout          = 300
  memory_size      = 320
  environment {
    variables = {
      CMR_ENVIRONMENT = var.cmr_environment
      stackName       = var.prefix
      system_bucket   = var.system_bucket
    }
  }

  tags = var.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = local.lambda_security_group_ids
    }
  }
}

data "aws_lambda_invocation" "custom_bootstrap" {
  count = var.elasticsearch_hostname != null ? 1 : 0
  depends_on = [aws_lambda_function.custom_bootstrap]
  function_name = aws_lambda_function.custom_bootstrap.function_name

  input = jsonencode({ elasticsearchHostname = var.elasticsearch_hostname })
}
