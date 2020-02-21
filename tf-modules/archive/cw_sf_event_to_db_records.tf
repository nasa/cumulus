resource "aws_iam_role" "cw_sf_event_to_db_records_lambda" {
  name                 = "${var.prefix}_cw_sf_event_to_db_records_lambda_role"
  assume_role_policy   = data.aws_iam_policy_document.assume_lambda_role.json
  permissions_boundary = var.permissions_boundary_arn
  tags                 = var.tags
}

data "aws_iam_policy_document" "cw_sf_event_to_db_records_lambda" {
  statement {
    actions   = ["dynamodb:UpdateItem"]
    resources = [
      var.dynamo_tables.executions.arn,
      var.dynamo_tables.granules.arn
    ]
  }

  statement {
    actions = [
      "states:DescribeExecution",
      "states:GetExecutionHistory"
    ]
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

  statement {
    actions = [
      "s3:GetObject*",
    ]
    resources = [for b in flatten([var.public_buckets, var.protected_buckets, var.private_buckets, var.system_bucket]) : "arn:aws:s3:::${b}/*"]
  }

  # Required for DLQ
  statement {
    actions = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.cw_sf_event_to_db_records_dead_letter_queue.arn]
  }
}

resource "aws_iam_role_policy" "cw_sf_event_to_db_records_lambda_role_policy" {
  name   = "${var.prefix}_cw_sf_event_to_db_records_lambda_role_policy"
  role   = aws_iam_role.cw_sf_event_to_db_records_lambda.id
  policy = data.aws_iam_policy_document.cw_sf_event_to_db_records_lambda.json
}

resource "aws_sqs_queue" "cw_sf_event_to_db_records_dead_letter_queue" {
  name                       = "${var.prefix}-cwSfEventToDbRecordsDeadLetterQueue"
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 60
  tags                       = var.tags
}

resource "aws_lambda_function" "cw_sf_event_to_db_records" {
  filename         = "${path.module}/../../packages/api/dist/cwSfEventToDbRecords/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/cwSfEventToDbRecords/lambda.zip")
  function_name    = "${var.prefix}-cwSfEventToDbRecords"
  role             = "${aws_iam_role.cw_sf_event_to_db_records_lambda.arn}"
  handler          = "index.handler"
  runtime          = "nodejs10.x"
  timeout          = 30
  memory_size      = 256

  dead_letter_config {
    target_arn = aws_sqs_queue.cw_sf_event_to_db_records_dead_letter_queue.arn
  }

  environment {
    variables = {
      ExecutionsTable = var.dynamo_tables.executions.name
      GranulesTable   = var.dynamo_tables.granules.name
    }
  }

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }

  tags = var.tags
}
