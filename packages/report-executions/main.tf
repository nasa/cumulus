provider "aws" {
  version = "~> 2.17"
  region  = "us-east-1"
  profile = var.aws_profile
}

data "archive_file" "replicator_package" {
  type        = "zip"
  source_file = "index.js"
  output_path = "build/report_executions.zip"
}

resource "aws_lambda_function" "report_executions" {
  filename         = "build/report_executions.zip"
  function_name    = "${var.prefix}-report-executions"
  role             = "${aws_iam_role.replicator_lambda_role.arn}"
  handler          = "index.handler"
  runtime          = "nodejs10.x"
  timeout          = 300

  source_code_hash = "${data.archive_file.replicator_package.output_base64sha256}"

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_groups
  }

  environment {
    variables = {
      EXECUTIONS_TABLE = "${var.prefix}-ExecutionsTable"
    }
  }
}

resource "aws_lambda_permission" "report_executions_permission" {
  action = "lambda:InvokeFunction"
  function_name = "${aws_lambda_function.report_executions.arn}"
  principal = "s3.amazonaws.com"
}
