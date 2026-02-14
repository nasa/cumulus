resource "aws_lambda_function" "cma_to_cnm" {
  filename      = "${path.module}/../dist/final/lambda.zip"
  function_name = "${var.prefix}-CMAToCNM"
  source_code_hash = filebase64sha256("${path.module}/cma2cnm.zip")
  handler       = "cma2cnm.cma_to_cnm.handler"
  role          = var.lambda_role
  runtime       = local.build_config.runtime
  timeout       = var.timeout
  memory_size   = var.memory_size
  architectures = [local.build_config.architecture]

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_group_ids
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "cma_to_cnm" {
  name              = "/aws/lambda/${aws_lambda_function.cma_to_cnm.function_name}"
  retention_in_days = var.default_log_retention_days
  tags              = var.tags
}