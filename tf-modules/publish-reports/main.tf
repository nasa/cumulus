locals {
  default_tags = {
    Deployment = var.prefix
  }
  state_machines_map = tomap({for index, arn in var.state_machine_arns : index => arn})
}

resource "aws_sqs_queue" "publish_reports_dead_letter_queue" {
  name                       = "${var.prefix}-publishReportsDeadLetterQueue"
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = 60
  tags                       = local.default_tags
}

data "archive_file" "publish_reports_package" {
  type        = "zip"
  source_file = "${path.module}/dist/index.js"
  output_path = "${path.module}/build/publish_reports.zip"
}

resource "aws_lambda_function" "publish_reports" {
  filename         = "${path.module}/build/publish_reports.zip"
  function_name    = "${var.prefix}-publishReports"
  role             = "${aws_iam_role.publish_reports_lambda_role.arn}"
  handler          = "index.handler"
  runtime          = "nodejs8.10"
  timeout          = 300
  memory_size      = 256

  dead_letter_config {
    target_arn = aws_sqs_queue.publish_reports_dead_letter_queue.arn
  }

  environment {
    variables = {
      execution_sns_topic_arn = var.execution_sns_topic_arn
      granule_sns_topic_arn   = var.granule_sns_topic_arn
      pdr_sns_topic_arn       = var.pdr_sns_topic_arn
    }
  }

  source_code_hash = "${data.archive_file.publish_reports_package.output_base64sha256}"

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_groups
  }

  tags = merge(local.default_tags, { Project = var.prefix })
}

resource "aws_cloudwatch_log_group" "publish_reports_logs" {
  name              = "/aws/lambda/${aws_lambda_function.publish_reports.function_name}"
  retention_in_days = 14
}

resource "aws_cloudwatch_event_rule" "cloudwatch_trigger_publish_reports" {
  for_each      = local.state_machines_map
  name          = "${var.prefix}-triggerPublishReports-${each.key}"
  event_pattern = <<PATTERN
{
  "source": ["aws.states"],
  "detail-type": ["Step Functions Execution Status Change"],
  "detail": {
    "stateMachineArn": ["${each.value}"]
  }
}
PATTERN
}

resource "aws_cloudwatch_event_target" "cloudwatch_target_publish_reports" {
  for_each      = local.state_machines_map
  rule      = "${aws_cloudwatch_event_rule.cloudwatch_trigger_publish_reports[each.key].name}"
  arn       = "${aws_lambda_function.publish_reports.arn}"
}

resource "aws_lambda_permission" "cloudwatch_publish_reports_permission" {
  for_each      = local.state_machines_map
  action        = "lambda:InvokeFunction"
  function_name = "${aws_lambda_function.publish_reports.function_name}"
  principal     = "events.amazonaws.com"
  source_arn    = "${aws_cloudwatch_event_rule.cloudwatch_trigger_publish_reports[each.key].arn}"
}
