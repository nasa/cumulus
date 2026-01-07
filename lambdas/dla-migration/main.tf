locals {
  lambda_path      = "${path.module}/dist/webpack/lambda.zip"
}
resource "aws_lambda_function" "dla_migration" {
  function_name    = "${var.prefix}-dlaMigration"
  filename         = local.lambda_path
  source_code_hash = filebase64sha256(local.lambda_path)
  handler          = "index.handler"
  role             = aws_iam_role.dla_migration_role.arn
  runtime          = "nodejs20.x"
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
      security_group_ids = [aws_security_group.dla_migration[0].id]
    }
  }
}
