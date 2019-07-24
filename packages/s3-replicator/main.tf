provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

data "archive_file" "replicator_package" {
  type        = "zip"
  source_file = "index.js"
  output_path = "build/replicator.zip"
}

resource "aws_lambda_function" "s3_replicator" {
  filename         = "build/replicator.zip"
  function_name    = "${var.prefix}-s3-replicator"
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
      TARGET_BUCKET = var.target_bucket
      TARGET_PREFIX = var.target_prefix
    }
  }
}

resource "aws_lambda_permission" "s3_replicator_permission" {
  action = "lambda:InvokeFunction"
  function_name = "${aws_lambda_function.s3_replicator.arn}"
  principal = "s3.amazonaws.com"
}

resource "aws_s3_bucket_notification" "s3_replicator_trigger" {
  bucket = "${var.source_bucket}"

  lambda_function {
    lambda_function_arn = "${aws_lambda_function.s3_replicator.arn}"
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "${var.source_prefix}"
  }
}
