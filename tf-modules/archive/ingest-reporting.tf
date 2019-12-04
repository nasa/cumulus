# Report executions

resource "aws_iam_role" "publish_executions_lambda_role" {
  name                 = "${var.prefix}-PublishExecutionsLambda"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
  tags                 = local.default_tags
}

data "aws_iam_policy_document" "publish_executions_policy_document" {
  statement {
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.report_executions_topic.arn]
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

  statement {
    actions = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.publish_executions_dead_letter_queue.arn]
  }

  statement {
    actions = [
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
      "dynamodb:DescribeStream",
      "dynamodb:ListStreams"
    ]
    resources = ["${var.dynamo_tables.executions.arn}/stream/*"]
  }
}

resource "aws_iam_role_policy" "publish_executions_lambda_role_policy" {
  name   = "${var.prefix}_publish_executions_lambda_role_policy"
  role   = aws_iam_role.publish_executions_lambda_role.id
  policy = data.aws_iam_policy_document.publish_executions_policy_document.json
}

resource "aws_sqs_queue" "publish_executions_dead_letter_queue" {
  name                       = "${var.prefix}-publishExecutionsDeadLetterQueue"
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 60
  tags                       = local.default_tags
}

resource "aws_lambda_function" "publish_executions" {
  depends_on = ["aws_cloudwatch_log_group.publish_executions_logs"]

  filename         = "${path.module}/../../packages/api/dist/publishExecutions/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/publishExecutions/lambda.zip")
  function_name    = "${var.prefix}-publishExecutions"
  role             = aws_iam_role.publish_executions_lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs8.10"
  timeout          = 30
  memory_size      = 128


  dead_letter_config {
    target_arn = aws_sqs_queue.publish_executions_dead_letter_queue.arn
  }

  vpc_config {
    subnet_ids = var.lambda_subnet_ids
    security_group_ids = [
      aws_security_group.no_ingress_all_egress[0].id
    ]
  }

  environment {
    variables = {
      execution_sns_topic_arn = aws_sns_topic.report_executions_topic.arn
    }
  }

  tags = local.default_tags
}

resource "aws_cloudwatch_log_group" "publish_executions_logs" {
  name              = "/aws/lambda/${var.prefix}-publishExecutions"
  retention_in_days = 14
  tags              = local.default_tags
}

resource "aws_sns_topic" "report_executions_topic" {
  name = "${var.prefix}-report-executions-topic"
  tags = local.default_tags
}

resource "aws_lambda_permission" "publish_executions_permission" {
  action        = "lambda:InvokeFunction"
  function_name = "${aws_lambda_function.publish_executions.function_name}"
  principal     = "sns.amazonaws.com"
  source_arn    = "${aws_sns_topic.report_executions_topic.arn}"
}

resource "aws_lambda_event_source_mapping" "publish_executions" {
  event_source_arn  = data.aws_dynamodb_table.executions.stream_arn
  function_name     = aws_lambda_function.publish_executions.arn
  starting_position = "TRIM_HORIZON"
  batch_size        = 10
}

# Report granules

resource "aws_iam_role" "report_granules_lambda_role" {
  name                 = "${var.prefix}-ReportGranulesLambda"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
  # TODO Re-enable once IAM permissions have been fixed
  # tags                 = local.default_tags
}

data "aws_iam_policy_document" "report_granules_policy_document" {
  statement {
    actions = [
      "dynamoDb:getItem",
      "dynamoDb:putItem"
    ]
    resources = [var.dynamo_tables.granules.arn]
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
      "states:DescribeExecution"
    ]
    resources = ["*"]
  }
  statement {
    actions = [
      "sqs:SendMessage"
    ]
    resources = [
      aws_sqs_queue.report_granules_dead_letter_queue.arn
    ]
  }
}

resource "aws_iam_role_policy" "report_granules_lambda_role_policy" {
  name   = "${var.prefix}_report_granules_lambda_role_policy"
  role   = aws_iam_role.report_granules_lambda_role.id
  policy = data.aws_iam_policy_document.report_granules_policy_document.json
}

resource "aws_sqs_queue" "report_granules_dead_letter_queue" {
  name                       = "${var.prefix}-reportGranulesDeadLetterQueue"
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 60
  tags                       = local.default_tags
}

resource "aws_lambda_function" "report_granules" {
  filename         = "${path.module}/../../packages/api/dist/reportGranules/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/reportGranules/lambda.zip")
  function_name    = "${var.prefix}-reportGranules"
  role             = aws_iam_role.report_granules_lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs8.10"
  timeout          = 30
  memory_size      = 256


  dead_letter_config {
    target_arn = aws_sqs_queue.report_granules_dead_letter_queue.arn
  }

  vpc_config {
    subnet_ids = var.lambda_subnet_ids
    security_group_ids = [
      aws_security_group.no_ingress_all_egress[0].id
    ]
  }

  environment {
    variables = {
      GranulesTable = var.dynamo_tables.granules.name
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

# Report PDRs

resource "aws_iam_role" "report_pdrs_lambda_role" {
  name                 = "${var.prefix}-ReportPdrsLambda"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
  # TODO Re-enable once IAM permissions have been fixed
  # tags                 = local.default_tags
}

data "aws_iam_policy_document" "report_pdrs_policy_document" {
  statement {
    actions = [
      "dynamoDb:getItem",
      "dynamoDb:putItem"
    ]
    resources = [var.dynamo_tables.pdrs.arn]
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
  statement {
    actions = [
      "sqs:SendMessage"
    ]
    resources = [
      aws_sqs_queue.report_pdrs_dead_letter_queue.arn
    ]
  }
}

resource "aws_iam_role_policy" "report_pdrs_lambda_role_policy" {
  name   = "${var.prefix}_report_pdrs_lambda_role_policy"
  role   = aws_iam_role.report_pdrs_lambda_role.id
  policy = data.aws_iam_policy_document.report_pdrs_policy_document.json
}

resource "aws_sqs_queue" "report_pdrs_dead_letter_queue" {
  name                       = "${var.prefix}-reportPdrsDeadLetterQueue"
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 60
  tags                       = local.default_tags
}

resource "aws_lambda_function" "report_pdrs" {
  filename         = "${path.module}/../../packages/api/dist/reportPdrs/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/reportPdrs/lambda.zip")
  function_name    = "${var.prefix}-reportPdrs"
  role             = "${aws_iam_role.report_pdrs_lambda_role.arn}"
  handler          = "index.handler"
  runtime          = "nodejs8.10"
  timeout          = 30
  memory_size      = 128

  dead_letter_config {
    target_arn = aws_sqs_queue.report_pdrs_dead_letter_queue.arn
  }

  vpc_config {
    subnet_ids = var.lambda_subnet_ids
    security_group_ids = [
      aws_security_group.no_ingress_all_egress[0].id
    ]
  }

  environment {
    variables = {
      PdrsTable = var.dynamo_tables.pdrs.name
    }
  }
}

resource "aws_cloudwatch_log_group" "report_pdrs_logs" {
  name              = "/aws/lambda/${aws_lambda_function.report_pdrs.function_name}"
  retention_in_days = 14
}

resource "aws_sns_topic" "report_pdrs_topic" {
  name = "${var.prefix}-report-pdrs-topic"
  # tags = local.default_tags
}

resource "aws_sns_topic_subscription" "report_pdrs_trigger" {
  topic_arn = aws_sns_topic.report_pdrs_topic.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.report_pdrs.arn
}

resource "aws_lambda_permission" "report_pdrs_permission" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.report_pdrs.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.report_pdrs_topic.arn
}
