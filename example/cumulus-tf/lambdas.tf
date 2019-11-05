resource "aws_lambda_function" "async_operation_fail" {
  function_name    = "${var.prefix}-AsyncOperationFail"
  filename         = "${path.module}/../lambdas/asyncOperations/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/asyncOperations/lambda.zip")
  handler          = "index.fail"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs8.10"

  tags = local.default_tags

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [aws_security_group.no_ingress_all_egress.id]
  }
}

resource "aws_lambda_function" "async_operation_success" {
  function_name    = "${var.prefix}-AsyncOperationSuccess"
  filename         = "${path.module}/../lambdas/asyncOperations/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/asyncOperations/lambda.zip")
  handler          = "index.success"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs8.10"

  tags = local.default_tags

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [aws_security_group.no_ingress_all_egress.id]
  }
}

resource "aws_lambda_function" "sns_s3_test" {
  function_name    = "${var.prefix}-SnsS3Test"
  filename         = "${path.module}/../lambdas/snsS3Test/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/snsS3Test/lambda.zip")
  handler          = "index.handler"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs8.10"

  environment {
    variables = {
      system_bucket = var.system_bucket
      stackName     = var.prefix
    }
  }

  tags = local.default_tags

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [aws_security_group.no_ingress_all_egress.id]
  }
}
