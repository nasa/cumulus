# Report executions

resource "aws_iam_role" "report_executions_lambda_role" {
  name                 = "${var.prefix}-ReportExecutionsLambda"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
  # TODO Re-enable once IAM permissions have been fixed
  # tags                 = local.default_tags
}

data "aws_iam_policy_document" "report_executions_policy_document" {
  statement {
    actions = [
      "dynamoDb:getItem",
      "dynamoDb:putItem"
    ]
    resources = [var.dynamo_tables.executions.arn]
  }
  statement {
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface"
    ]
    resources = ["*"]
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
}

resource "aws_iam_role_policy" "report_executions_lambda_role_policy" {
  name   = "${var.prefix}_report_executions_lambda_role_policy"
  role   = aws_iam_role.report_executions_lambda_role.id
  policy = data.aws_iam_policy_document.report_executions_policy_document.json
}

resource "aws_lambda_function" "report_executions" {
  depends_on = ["aws_cloudwatch_log_group.report_executions_logs"]

  filename         = "${path.module}/../../packages/api/dist/reportExecutions/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/reportExecutions/lambda.zip")
  function_name    = "${var.prefix}-reportExecutions"
  role             = "${aws_iam_role.report_executions_lambda_role.arn}"
  handler          = "index.handler"
  runtime          = "nodejs8.10"
  timeout          = 30
  memory_size      = 128

  vpc_config {
    subnet_ids = var.lambda_subnet_ids
    security_group_ids = [
      aws_security_group.no_ingress_all_egress[0].id
    ]
  }

  environment {
    variables = {
      ExecutionsTable = var.dynamo_tables.executions.name
    }
  }

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
