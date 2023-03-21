resource "aws_lambda_function" "custom_bootstrap" {
  function_name    = "${var.prefix}-CustomBootstrap"
  filename         = "${path.module}/../../packages/api/dist/bootstrap/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/bootstrap/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs16.x"
  timeout          = 300
  memory_size      = 320
  environment {
    variables = {
      stackName                     = var.prefix
      system_bucket                 = var.system_bucket
      ES_INDEX_SHARDS               = var.es_index_shards
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

  input = jsonencode(
    {
      elasticsearchHostname = var.elasticsearch_hostname
      removeAliasConflict = var.elasticsearch_remove_index_alias_conflict
      replacementTrigger = timestamp()
    })
}

resource "aws_cloudwatch_log_group" "custom_bootstrap" {
  name = "/aws/lambda/${aws_lambda_function.custom_bootstrap.function_name}"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "CustomBootstrap", var.default_log_retention_days)
  tags = var.tags
}
