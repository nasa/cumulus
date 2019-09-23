locals {
  default_tags = { Deployment = var.prefix }
}

data "archive_file" "report_executions_package" {
  type        = "zip"
  source_file = "${path.module}/node_modules/@cumulus/api/dist/reportExecutions/index.js"
  output_path = "${path.module}/build/report_executions.zip"
}

resource "aws_lambda_function" "report_executions" {
  filename         = "${path.module}/build/report_executions.zip"
  function_name    = "${var.prefix}-reportExecutions"
  role             = "${aws_iam_role.report_executions_lambda_role.arn}"
  handler          = "index.handler"
  runtime          = "nodejs8.10"
  timeout          = 30
  memory_size      = 128

  source_code_hash = "${data.archive_file.report_executions_package.output_base64sha256}"

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_groups
  }

  environment {
    variables = {
      ExecutionsTable = "${var.executions_table}"
    }
  }

  depends_on = ["aws_cloudwatch_log_group.report_executions_logs"]

  tags = local.default_tags
}

resource "aws_cloudwatch_log_group" "report_executions_logs" {
  name              = "/aws/lambda/${var.prefix}-reportExecutions"
  retention_in_days = 14
  tags              = local.default_tags
}

resource "aws_sns_topic" "report_executions_topic" {
  name = "${var.prefix}-report-executions-topic"
  tags = local.default_tags
}

resource "aws_lambda_permission" "report_executions_permission" {
  action        = "lambda:InvokeFunction"
  function_name = "${aws_lambda_function.report_executions.function_name}"
  principal     = "sns.amazonaws.com"
  source_arn    = "${aws_sns_topic.report_executions_topic.arn}"
}

resource "aws_sns_topic_subscription" "report_executions_subscription" {
  topic_arn = "${aws_sns_topic.report_executions_topic.arn}"
  protocol  = "lambda"
  endpoint  = "${aws_lambda_function.report_executions.arn}"
}
