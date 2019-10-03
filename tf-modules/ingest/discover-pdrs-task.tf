resource "aws_lambda_function" "discover_pdrs_task" {
  function_name    = "${var.prefix}-DiscoverPdrs"
  filename         = "${path.module}/../../tasks/discover-pdrs/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../tasks/discover-pdrs/dist/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
  timeout          = 300
  memory_size      = 1024

  layers = [var.cumulus_message_adapter_lambda_layer_arn]

  environment {
    variables = {
      CMR_ENVIRONMENT             = var.cmr_environment
      stackName                   = var.prefix
      CUMULUS_MESSAGE_ADAPTER_DIR = "/opt/"
    }
  }

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }

  tags = merge(local.default_tags, { Project = var.prefix })
}

resource "aws_cloudwatch_log_group" "discover_pdrs_task" {
  name              = "/aws/lambda/${aws_lambda_function.discover_pdrs_task.function_name}"
  retention_in_days = 30
  tags              = local.default_tags
}

resource "aws_cloudwatch_log_subscription_filter" "discover_pdrs_task" {
  name            = "${var.prefix}-DiscoverPdrsLogSubscription"
  destination_arn = var.log2elasticsearch_lambda_function_arn
  log_group_name  = aws_cloudwatch_log_group.discover_pdrs_task.name
  filter_pattern  = ""
  distribution    = "ByLogStream"
}
