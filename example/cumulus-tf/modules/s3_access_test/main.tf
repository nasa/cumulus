terraform {
  required_providers {
    aws = ">= 2.31.0"
  }
}

locals {
  default_tags = {
    Deployment = var.prefix
  }
}

resource "aws_lambda_function" "s3_acccess_test" {
  function_name    = "${var.prefix}-s3AccessTest"
  description      = "Lambda for integration testing direct S3 access"
  filename         = "${path.module}/../../../lambdas/s3AccessTest/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../lambdas/s3AccessTest/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"

  tags = local.default_tags
}
