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

  source_code_hash = "${data.archive_file.publish_notifications_package.output_base64sha256}"
  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_groups
  }
}

resource "aws_cloudwatch_log_group" "publish_notifications_logs" {
  name              = "/aws/lambda/${aws_lambda_function.publish_notifications.function_name}"
  retention_in_days = 14
}

resource "aws_lambda_permission" "cloudwatch_publish_notifications_permission" {
  action        = "lambda:InvokeFunction"
  function_name = "${aws_lambda_function.publish_notifications.function_name}"
  principal     = "events.amazonaws.com"
  source_arn    = "${aws_sns_topic.publish_notifications_topic.arn}"
}
