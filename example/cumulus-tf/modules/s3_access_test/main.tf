terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 3.0,!= 3.14.0"
    }
  }
}

resource "aws_lambda_function" "s3_acccess_test" {
  function_name    = "${var.prefix}-s3AccessTest"
  description      = "Lambda for integration testing direct S3 access"
  filename         = "${path.module}/../../../lambdas/s3AccessTest/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../lambdas/s3AccessTest/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs16.x"

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "s3_acccess_test" {
  name              = "/aws/lambda/${aws_lambda_function.s3_acccess_test.function_name}"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "s3AccessTest_log_retention", var.default_log_retention_days)
  tags              = var.tags
}
