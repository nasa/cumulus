locals {
  build_config = jsondecode(file("${path.module}/../build-config.json"))
}

resource "aws_lambda_function" "cma_to_cnm" {
  filename         = "${path.module}/../dist/final/lambda.zip"
  function_name    = "${var.prefix}-CMAToCNM"
  filebase64sha256 ="${path.module}/../dist/final/lambda.zip")
  handler          = "cma_to_cnm.cma_to_cnm.handler"
  role             = var.lambda_role
  runtime          = "python3.12"
  timeout          = var.timeout
  memory_size      = var.memory_size

  environment {
    variables = {
      stackName                   = var.prefix
      CUMULUS_MESSAGE_ADAPTER_DIR = "/opt/"
    }
  }

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_group_ids
  }

  tags = local.tags
}

resource "aws_cloudwatch_log_group" "cma_to_cnm" {
  name              = "/aws/lambda/${aws_lambda_function.cma_to_cnm.function_name}"
  retention_in_days = var.default_log_retention_days
  tags              = local.tags
}