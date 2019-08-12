resource "aws_lambda_function" "kinesis_inbound_event_logger" {
  function_name    = "${var.prefix}-KinesisInboundEventLogger"
  filename         = "${path.module}/../../packages/api/dist/payloadLogger/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/payloadLogger/lambda.zip")
  handler          = "index.handler"
  role             = aws_iam_role.lambda_processing.arn
  runtime          = "nodejs8.10"
  timeout          = 300
  memory_size      = 128
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
