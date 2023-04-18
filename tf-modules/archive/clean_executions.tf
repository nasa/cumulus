resource "aws_sqs_queue" "clean_executions_dead_letter_queue" {
  name                       = "${var.prefix}-cleanExecutionsDeadLetterQueue"
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 60

  tags = var.tags
}

resource "aws_lambda_function" "clean_executions" {
  depends_on       = [aws_cloudwatch_log_group.clean_executions]
  function_name    = "${var.prefix}-cleanExecutions"
  filename         = "${path.module}/../../packages/api/dist/cleanExecutions/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/cleanExecutions/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs16.x"
  timeout          = 900
  memory_size      = 192
  dead_letter_config {
    target_arn = aws_sqs_queue.clean_executions_dead_letter_queue.arn
  }
  environment {
    variables = {
      stackName       = var.prefix

      completeExecutionPayloadTimeoutDisable = var.complete_execution_payload_timeout_disable
      completeExecutionPayloadTimeout        = var.complete_execution_payload_timeout

      nonCompleteExecutionPayloadTimeoutDisable = var.non_complete_execution_payload_timeout_disable
      nonCompleteExecutionPayloadTimeout        = var.non_complete_execution_payload_timeout
    }
  }

  tags = var.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [
        aws_security_group.no_ingress_all_egress[0].id
      ]
    }
  }
}

resource "aws_cloudwatch_event_rule" "daily_execution_payload_cleanup" {
  name = "${var.prefix}_daily_execution_payload_cleanup"
  schedule_expression = var.daily_execution_payload_cleanup_schedule_expression
  tags                = var.tags
}

resource "aws_cloudwatch_event_target" "daily_execution_payload_cleanup" {
  target_id = "clean_executions_lambda_target"
  rule = aws_cloudwatch_event_rule.daily_execution_payload_cleanup.name
  arn  = aws_lambda_function.clean_executions.arn
}

resource "aws_lambda_permission" "daily_execution_payload_cleanup" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.clean_executions.arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_execution_payload_cleanup.arn
}

resource "aws_cloudwatch_log_group" "clean_executions" {
  name = "/aws/lambda/${var.prefix}-cleanExecutions"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "cleanExecutions", var.default_log_retention_days)
  tags = var.tags
}
