terraform {
  required_providers {
    aws = ">= 2.31.0"
  }
}

resource "aws_sfn_state_machine" "default" {
  name       = "${var.prefix}-${var.name}"
  role_arn   = var.workflow_config.state_machine_role_arn
  definition = var.state_machine_definition
  tags       = var.tags
}

resource "aws_cloudwatch_event_rule" "state_machine_execution_rule" {
  name = "${var.prefix}-${var.name}-rule"
  event_pattern = jsonencode({
    source      = ["aws.states"]
    detail-type = ["Step Functions Execution Status Change"]
    detail = {
      stateMachineArn = [aws_sfn_state_machine.default.id]
    }
  })
  tags = var.tags
}

resource "aws_cloudwatch_event_target" "semaphore_down" {
  rule = aws_cloudwatch_event_rule.state_machine_execution_rule.name
  arn  = var.workflow_config.sf_semaphore_down_lambda_function_arn
}

resource "aws_lambda_permission" "semaphore_down" {
  action        = "lambda:InvokeFunction"
  function_name = var.workflow_config.sf_semaphore_down_lambda_function_arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.state_machine_execution_rule.arn
}

resource "aws_cloudwatch_event_target" "sf_event_sqs_to_db_records" {
  rule = aws_cloudwatch_event_rule.state_machine_execution_rule.name
  arn  = var.workflow_config.sf_event_sqs_to_db_records_sqs_queue_arn
}

resource "aws_cloudwatch_event_target" "sqs_message_remover" {
  rule = aws_cloudwatch_event_rule.state_machine_execution_rule.name
  arn  = var.workflow_config.sqs_message_remover_lambda_function_arn
}

resource "aws_lambda_permission" "sqs_message_remover" {
  action        = "lambda:InvokeFunction"
  function_name = var.workflow_config.sqs_message_remover_lambda_function_arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.state_machine_execution_rule.arn
}

locals {
  workflow_info = jsonencode({
    name       = var.name
    arn        = aws_sfn_state_machine.default.id
    definition = jsondecode(var.state_machine_definition)
  })
}

resource "aws_s3_bucket_object" "workflow_info" {
  bucket  = var.system_bucket
  key     = "${var.prefix}/workflows/${var.name}.json"
  content = local.workflow_info
  etag    = md5(local.workflow_info)
}
