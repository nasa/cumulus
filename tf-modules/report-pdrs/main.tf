data "archive_file" "report_pdrs_package" {
  type        = "zip"
  source_file = "${path.module}/node_modules/@cumulus/api/dist/reportPdrs/index.js"
  output_path = "${path.module}/build/report_pdrs.zip"
}

resource "aws_lambda_function" "report_pdrs" {
  filename         = "${path.module}/build/report_pdrs.zip"
  function_name    = "${var.prefix}-reportPdrs"
  role             = "${aws_iam_role.report_pdrs_lambda_role.arn}"
  handler          = "index.handler"
  runtime          = "nodejs8.10"
  timeout          = 30
  memory_size      = 128

  source_code_hash = "${data.archive_file.report_pdrs_package.output_base64sha256}"
  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_groups
  }
  environment {
    variables = {
      PdrsTable = var.pdrs_table
    }
  }
}

resource "aws_cloudwatch_log_group" "report_pdrs_logs" {
  name              = "/aws/lambda/${aws_lambda_function.report_pdrs.function_name}"
  retention_in_days = 14
}

resource "aws_sns_topic" "report_pdrs_topic" {
  name = "${var.prefix}-report-pdrs-topic"
}

resource "aws_sns_topic_subscription" "report_pdrs_trigger" {
  topic_arn = aws_sns_topic.report_pdrs_topic.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.report_pdrs.arn
}

resource "aws_lambda_permission" "report_pdrs_permission" {
  action        = "lambda:InvokeFunction"
  function_name = "${aws_lambda_function.report_pdrs.function_name}"
  principal     = "sns.amazonaws.com"
  source_arn    = "${aws_sns_topic.report_pdrs_topic.arn}"
}
