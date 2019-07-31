provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

data "archive_file" "granule_reporter_package" {
  type        = "zip"
  source_file = "index.js"
  output_path = "build/granule_reporter.zip"
}

resource "aws_lambda_function" "granule_reporter" {
  filename         = "build/granule_reporter.zip"
  function_name    = "${var.prefix}-report-granules"
  role             = "${aws_iam_role.granule_reporter_lambda_role.arn}"
  handler          = "index.handler"
  runtime          = "nodejs8.10"
  timeout          = 300

  source_code_hash = "${data.archive_file.granule_reporter_package.output_base64sha256}"
  vpc_config {
    subnet_ids = var.subnet_ids
    security_group_ids = var.security_groups
  }

  environment {
    variables = {
      granulesTable = var.granules_table
    }
  }
}

resource "aws_sns_topic" "granules_topic" {
  name = "${var.prefix}_granule_reporting_topic"
}

resource "aws_sns_topic_subscription" "granules_reporting_trigger" {
  topic_arn = aws_sns_topic.granules_topic.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.granule_reporter.arn
}