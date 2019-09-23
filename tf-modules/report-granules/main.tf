locals {
  default_tags = { Deployment = var.prefix }
}

data "archive_file" "report_granules_package" {
  type        = "zip"
  source_file = "${path.module}/node_modules/@cumulus/api/dist/reportGranules/index.js"
  output_path = "${path.module}/build/report_granules.zip"
}

resource "aws_lambda_function" "report_granules" {
  filename         = "${path.module}/build/report_granules.zip"
  function_name    = "${var.prefix}-reportGranules"
  role             = "${aws_iam_role.report_granules_lambda_role.arn}"
  handler          = "index.handler"
  runtime          = "nodejs8.10"
  timeout          = 30
  memory_size      = 256

  source_code_hash = "${data.archive_file.report_granules_package.output_base64sha256}"
  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_groups
  }
  environment {
    variables = {
      GranulesTable = var.granules_table
    }
  }

  tags = local.default_tags
}

resource "aws_cloudwatch_log_group" "report_granules_logs" {
  name              = "/aws/lambda/${aws_lambda_function.report_granules.function_name}"
  retention_in_days = 14
  tags              = local.default_tags
}

resource "aws_sns_topic" "report_granules_topic" {
  name = "${var.prefix}-report-granules-topic"
  tags = local.default_tags
}

resource "aws_sns_topic_subscription" "report_granules_trigger" {
  topic_arn = aws_sns_topic.report_granules_topic.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.report_granules.arn
}

resource "aws_lambda_permission" "report_granules_permission" {
  action        = "lambda:InvokeFunction"
  function_name = "${aws_lambda_function.report_granules.function_name}"
  principal     = "sns.amazonaws.com"
  source_arn    = "${aws_sns_topic.report_granules_topic.arn}"
}
