resource "aws_lambda_function" "parse_pdr_task" {
  function_name    = "${var.prefix}-ParsePdr"
  filename         = "${path.module}/../../tasks/parse-pdr/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../tasks/parse-pdr/dist/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs16.x"
  timeout          = lookup(var.lambda_timeouts, "parse_pdr_task_timeout", 300)
  memory_size      = lookup(var.lambda_memory_sizes, "parse_pdr_task_memory_size", 1024)

  layers = [var.cumulus_message_adapter_lambda_layer_version_arn]

  environment {
    variables = {
      stackName                   = var.prefix
      CUMULUS_MESSAGE_ADAPTER_DIR = "/opt/"
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [
        aws_security_group.no_ingress_all_egress[0].id
      ]
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "parse_pdr_task" {
  name              = "/aws/lambda/${aws_lambda_function.parse_pdr_task.function_name}"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "parsePdrtask_log_retention", var.default_log_retention_days)
  tags              = var.tags
}
