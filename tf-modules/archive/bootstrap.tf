resource "aws_lambda_function" "custom_bootstrap" {
  function_name    = "${var.prefix}-CustomBootstrap"
  filename         = "${path.module}/../../packages/api/dist/bootstrap/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/bootstrap/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs20.x"
  timeout          = lookup(var.lambda_timeouts, "CustomBootstrap", 300)
  memory_size      = lookup(var.lambda_memory_sizes, "CustomBootstrap", 512)
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
