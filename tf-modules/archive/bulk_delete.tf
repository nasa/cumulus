resource "aws_lambda_function" "bulk_delete" {
  function_name    = "${var.prefix}-BulkDelete"
  filename         = "${path.module}/../../packages/api/dist/bulkDelete/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/bulkDelete/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs10.x"
  memory_size      = 1024
  timeout          = 300
  environment {
    variables = {
      CMR_ENVIRONMENT = var.cmr_environment
      stackName       = var.prefix
    }
  }

  tags = var.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [
        aws_security_group.no_ingress_all_egress[0].id
      ]
    }
  }
}
