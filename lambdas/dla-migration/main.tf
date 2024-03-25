resource "aws_lambda_function" "dla_migration" {
  function_name    = "${var.prefix}-dlaMigration"
  filename         = "${path.module}/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/dist/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs16.x"
  timeout          = lookup(var.lambda_timeouts, "dlaMigration", 900)
  memory_size      = lookup(var.lambda_memory_sizes, "dlaMigration", 512)
  environment {
    variables = {
      stackName        = var.prefix
      system_bucket    = var.system_bucket
    }
  }
  tags = var.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = var.security_group_ids
    }
  }
}

