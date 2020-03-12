locals {
  # Pulled out into a local to prevent cyclic dependencies
  # between the IAM role, queue and lambda function.
  sf_event_sqs_lambda_timeout = 30
}

resource "aws_iam_role" "sf_event_sqs_to_db_records_lambda" {
  name                 = "${var.prefix}_sf_event_sqs_to_db_records_lambda_role"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
  tags                 = var.tags
}

data "aws_iam_policy_document" "sf_event_sqs_to_db_records_lambda" {
  statement {
    actions   = ["dynamodb:UpdateItem"]
    resources = [
      var.dynamo_tables.executions.arn,
      var.dynamo_tables.granules.arn,
      var.dynamo_tables.pdrs.arn
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
    resources = [
      aws_sqs_queue.sf_event_sqs_to_db_records_dead_letter_queue.arn
    ]
  }

  statement {
    actions = [
      "sqs:ReceiveMessage",
      "sqs:ChangeMessageVisibility",
      "sqs:DeleteMessage",
      "sqs:GetQueueUrl",
      "sqs:GetQueueAttributes"
    ]
    resources = [
      aws_sqs_queue.sf_event_sqs_to_db_records_input_queue.arn
    ]
  }
}

resource "aws_iam_role_policy" "sf_event_sqs_to_db_records_lambda_role_policy" {
  name   = "${var.prefix}_sf_event_sqs_to_db_records_lambda_role_policy"
  role   = aws_iam_role.sf_event_sqs_to_db_records_lambda.id
  policy = data.aws_iam_policy_document.sf_event_sqs_to_db_records_lambda.json
}



resource "aws_sqs_queue" "sf_event_sqs_to_db_records_input_queue" {
  name = "${var.prefix}-sfEventSqsToDbRecordsInputQueue"
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = (local.sf_event_sqs_lambda_timeout * 6)
  redrive_policy             = jsonencode(
    {
      deadLetterTargetArn = aws_sqs_queue.sf_event_sqs_to_db_records_dead_letter_queue.arn
      maxReceiveCount     = 10
  })
  tags                       = var.tags
}

data "aws_iam_policy_document" "sf_event_sqs_send_message_policy" {
  statement {
    actions = ["sqs:sendMessage"]
    resources = [aws_sqs_queue.sf_event_sqs_to_db_records_input_queue.arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_sqs_queue_policy" "sf_event_sqs_to_db_records_input_queue_policy" {
  queue_url = aws_sqs_queue.sf_event_sqs_to_db_records_input_queue.id
  policy = data.aws_iam_policy_document.sf_event_sqs_send_message_policy.json
}

resource "aws_lambda_event_source_mapping" "sf_event_sqs_to_db_records_mapping" {
  event_source_arn = aws_sqs_queue.sf_event_sqs_to_db_records_input_queue.arn
  function_name    = aws_lambda_function.sf_event_sqs_to_db_records.arn
}

resource "aws_sqs_queue" "sf_event_sqs_to_db_records_dead_letter_queue" {
  name                       = "${var.prefix}-sfEventSqsToDbRecordsDeadLetterQueue"
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 60
  tags                       = var.tags
}

resource "aws_lambda_function" "sf_event_sqs_to_db_records" {
  filename         = "${path.module}/../../packages/api/dist/sfEventSqsToDbRecords/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/sfEventSqsToDbRecords/lambda.zip")
  function_name    = "${var.prefix}-sfEventSqsToDbRecords"
  role             = aws_iam_role.sf_event_sqs_to_db_records_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs10.x"
  timeout          = local.sf_event_sqs_lambda_timeout
  memory_size      = 256

  dead_letter_config {
    target_arn = aws_sqs_queue.sf_event_sqs_to_db_records_dead_letter_queue.arn
  }

  environment {
    variables = {
      ExecutionsTable = var.dynamo_tables.executions.name
      GranulesTable   = var.dynamo_tables.granules.name
      PdrsTable       = var.dynamo_tables.pdrs.name
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [
        aws_security_group.no_ingress_all_egress[0].id
      ]
    }
  }

  tags = var.tags
}
