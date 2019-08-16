resource "aws_lambda_function" "bulk_delete" {
  function_name    = "${var.prefix}-BulkDelete"
  filename         = "${path.module}/../../packages/api/dist/BulkDelete/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/BulkDelete/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
  memory_size      = 1024
  timeout          = 300
  environment {
    variables = {
      CMR_ENVIRONMENT = var.cmr_environment
      stackName       = var.prefix
    }
  }
  tags = {
    Project = var.prefix
  }
  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = [aws_security_group.no_ingress_all_egress.id]
  }
}
