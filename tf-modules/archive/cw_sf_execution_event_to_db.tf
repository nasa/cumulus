resource "aws_iam_role" "cw_sf_execution_event_to_db_lambda" {
  name                 = "${var.prefix}_cw_sf_execution_event_to_db_lambda_role"
  assume_role_policy   = data.aws_iam_policy_document.assume_lambda_role.json
  permissions_boundary = var.permissions_boundary_arn
  tags                 = local.default_tags
}

data "aws_iam_policy_document" "cw_sf_execution_event_to_db_lambda" {
  statement {
    actions   = ["dynamodb:UpdateItem"]
    resources = [var.dynamo_tables.executions.arn]
  }

  statement {
    actions = ["states:GetExecutionHistory"]
    resources = ["*"]
  }

  statement {
    actions = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${var.system_bucket}/*"]
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

  # Required for DLQ
  statement {
    actions = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.cw_sf_execution_event_to_db_dead_letter_queue.arn]
  }
}

resource "aws_iam_role_policy" "cw_sf_execution_event_to_db_lambda_role_policy" {
  name   = "${var.prefix}_cw_sf_execution_event_to_db_lambda_role_policy"
  role   = aws_iam_role.cw_sf_execution_event_to_db_lambda.id
  policy = data.aws_iam_policy_document.cw_sf_execution_event_to_db_lambda.json
}

resource "aws_sqs_queue" "cw_sf_execution_event_to_db_dead_letter_queue" {
  name                       = "${var.prefix}-cwSfExecutionEventToDbDeadLetterQueue"
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 60
  tags                       = local.default_tags
}

resource "aws_lambda_function" "cw_sf_execution_event_to_db" {
  filename         = "${path.module}/../../packages/api/dist/cwSfExecutionEventToDb/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/cwSfExecutionEventToDb/lambda.zip")
  function_name    = "${var.prefix}-cwSfExecutionEventToDb"
  role             = "${aws_iam_role.cw_sf_execution_event_to_db_lambda.arn}"
  handler          = "index.handler"
  runtime          = "nodejs8.10"

  dead_letter_config {
    target_arn = aws_sqs_queue.cw_sf_execution_event_to_db_dead_letter_queue.arn
  }

  environment {
    variables = {
      ExecutionsTable = var.dynamo_tables.executions.name
    }
  }

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }

  tags = merge(local.default_tags, { Project = var.prefix })
}
