resource "aws_lambda_function" "cma_to_cnm" {
  filename      = "${path.module}/cma2cnm.zip"
  function_name = "${var.prefix}-CMAToCNM"
  source_code_hash = filebase64sha256("${path.module}/cma2cnm.zip")
  handler       = "cma2cnm.cma_to_cnm.handler"
  role          = var.lambda_role
  runtime       = "python3.13"
  timeout       = var.timeout
  memory_size   = var.memory_size

  environment {
    variables = {
      LOGGING_LEVEL               = var.log_level
    }
  }

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_group_ids
  }

  tags = local.tags
}
