# Publish reports

data "aws_iam_policy_document" "assume_lambda_role" {
  statement {
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions   = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "publish_reports_lambda_role" {
  name                 = "${var.prefix}_publish_reports_lambda_role"
  assume_role_policy   = data.aws_iam_policy_document.assume_lambda_role.json
  permissions_boundary = var.permissions_boundary_arn
  # TODO Re-enable once IAM permissions have been fixed
  # tags                 = local.default_tags
}

data "aws_iam_policy_document" "publish_reports_policy_document" {
  statement {
    actions = [
      "dynamoDb:getItem"
    ]
    resources = [var.dynamo_tables.executions.arn]
  }

  statement {
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface"
    ]
    resources = [
      "*"
    ]
  }

  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents"
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "s3:GetObject*",
    ]
    resources = [for b in flatten([var.public_buckets, var.protected_buckets, var.private_buckets, var.system_bucket]) : "arn:aws:s3:::${b}/*"]
  }

  statement {
    actions = [
      "SNS:Publish"
    ]
    resources = [
      aws_sns_topic.report_granules_topic.arn,
      aws_sns_topic.report_pdrs_topic.arn
    ]
  }

  statement {
    actions = [
      "sqs:SendMessage"
    ]
    resources = [
      aws_sqs_queue.publish_reports_dead_letter_queue.arn
    ]
  }

  statement {
    actions = [
      "states:DescribeExecution",
      "states:GetExecutionHistory"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "publish_reports_lambda_role_policy" {
  name   = "${var.prefix}_publish_reports_lambda_role_policy"
  role   = aws_iam_role.publish_reports_lambda_role.id
  policy = data.aws_iam_policy_document.publish_reports_policy_document.json
}

resource "aws_sqs_queue" "publish_reports_dead_letter_queue" {
  name                       = "${var.prefix}-publishReportsDeadLetterQueue"
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 60
  tags                       = local.default_tags
}

resource "aws_lambda_function" "publish_reports" {
  filename         = "${path.module}/../../packages/api/dist/publishReports/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/publishReports/lambda.zip")
  function_name    = "${var.prefix}-publishReports"
  role             = "${aws_iam_role.publish_reports_lambda_role.arn}"
  handler          = "index.handler"
  runtime          = "nodejs8.10"
  timeout          = 30
  memory_size      = 512

  dead_letter_config {
    target_arn = aws_sqs_queue.publish_reports_dead_letter_queue.arn
  }

  environment {
    variables = {
      granule_sns_topic_arn   = aws_sns_topic.report_granules_topic.arn
      pdr_sns_topic_arn       = aws_sns_topic.report_pdrs_topic.arn
    }
  }

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }

  tags = merge(local.default_tags, { Project = var.prefix })
}

resource "aws_cloudwatch_log_group" "publish_reports_logs" {
  name              = "/aws/lambda/${aws_lambda_function.publish_reports.function_name}"
  retention_in_days = 14
  tags              = local.default_tags
}
