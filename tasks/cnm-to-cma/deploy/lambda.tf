resource "aws_lambda_function" "cnm_to_cma" {
  filename      = "${path.module}/cnm2cma.zip"
  function_name = "${var.prefix}-CNMToCMA"
  source_code_hash = filebase64sha256("${path.module}/cnm2cma.zip")
  handler       = "cnm2cma.cnm_to_cma.handler"
  role          = var.lambda_role
  runtime       = "python3.13"
  timeout       = var.timeout
  memory_size   = var.memory_size

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_group_ids
  }

  tags = local.tags
}

resource "aws_cloudwatch_log_group" "granule_invalidator_task" {
  name              = "/aws/lambda/${aws_lambda_function.cnm_to_cma.function_name}"
  retention_in_days = var.default_log_retention_days
  tags              = local.tags
}
