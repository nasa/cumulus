locals {
  default_tags = {
    Deployment = var.prefix
  }
}

resource "aws_sqs_queue" "publish_notifications_dead_letter_queue" {
  name                       = "${var.prefix}-publishNotificationsDeadLetterQueue"
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = 60
  tags                       = local.default_tags
}

data "archive_file" "publish_notifications_package" {
  type        = "zip"
  source_file = "dist/index.js"
  output_path = "build/publish_notifications.zip"
}

resource "aws_lambda_function" "publish_notifications" {
  filename         = "build/publish_notifications.zip"
  function_name    = "${var.prefix}-publish-notifications"
  role             = "${aws_iam_role.publish_notifications_lambda_role.arn}"
  handler          = "index.handler"
  runtime          = "nodejs8.10"
  timeout          = 300
  memory_size      = 256

  dead_letter_config {
    target_arn = aws_sqs_queue.publish_notifications_dead_letter_queue.arn
  }

  environment {
    variables = {
      execution_sns_topic_arn = var.execution_sns_topic_arn
      granule_sns_topic_arn   = var.granule_sns_topic_arn
      pdr_sns_topic_arn       = var.pdr_sns_topic_arn
    }
  }

  source_code_hash = "${data.archive_file.publish_notifications_package.output_base64sha256}"

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_groups
  }

  tags = merge(local.default_tags, { Project = var.prefix })
}

resource "aws_cloudwatch_log_group" "publish_notifications_logs" {
  name              = "/aws/lambda/${aws_lambda_function.publish_notifications.function_name}"
  retention_in_days = 14
}

resource "aws_cloudwatch_event_rule" "cloudwatch_trigger_publish_notifications" {
  name        = "trigger-publish-notifications"
  description = "Trigger for publish-notfications Lambda"

  event_pattern = <<PATTERN
{
  "source": ["aws.states"],
  "detail-type": ["Step Functions Execution Status Change"],
  "detail": {
    "stateMachineArn": "${join(", ", var.state_machines_arns)}"
  }
}
PATTERN
}

resource "aws_lambda_permission" "cloudwatch_publish_notifications_permission" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = "${aws_lambda_function.publish_notifications.function_name}"
  principal     = "events.amazonaws.com"
  source_arn    = "${aws_cloudwatch_event_rule.cloudwatch_trigger_publish_notifications.arn}"
}
