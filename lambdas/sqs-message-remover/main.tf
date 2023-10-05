resource "aws_lambda_function" "sqs_message_remover" {
  function_name    = "${var.prefix}-sqsMessageRemover"
  filename         = "${path.module}/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/dist/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs16.x"
  timeout          = 100
  memory_size      = lookup(var.lambda_memory_sizes, "sqs_message_remover_memory_size", 512)
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
