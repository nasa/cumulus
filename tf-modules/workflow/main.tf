resource "aws_sfn_state_machine" "default" {
  name       = "${var.prefix}-${var.name}"
  role_arn   = var.state_machine_role_arn
  definition = var.state_machine_definition
  tags       = var.tags
}

resource "aws_cloudwatch_event_rule" "state_machine_execution_finished" {
  event_pattern = jsonencode({
    source      = ["aws.states"]
    detail-type = ["Step Functions Execution Status Change"]
    detail = {
      status          = ["ABORTED", "FAILED", "SUCCEEDED", "TIMED_OUT"]
      stateMachineArn = [aws_sfn_state_machine.default.id]
    }
  })
  tags = var.tags
}

resource "aws_cloudwatch_event_target" "semaphore_down" {
  rule = aws_cloudwatch_event_rule.state_machine_execution_finished.name
  arn  = var.sf_semaphore_down_lambda_function_arn
}

resource "aws_lambda_permission" "semaphore_down" {
  action        = "lambda:InvokeFunction"
  function_name = var.sf_semaphore_down_lambda_function_arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.state_machine_execution_finished.arn
}

locals {
  workflow_info = jsonencode({
    name       = var.name
    arn        = aws_sfn_state_machine.default.id
    definition = var.state_machine_definition
  })
}

resource "aws_s3_bucket_object" "workflow_info" {
  bucket  = var.system_bucket
  key     = "${var.prefix}/workflows/${var.name}.json"
  content = local.workflow_info
  etag    = md5(local.workflow_info)
}
