locals {
  # Pulled out into a local to prevent cyclic dependencies
  # between the IAM role, queue and lambda function.
  sf_event_sqs_lambda_timeout = (var.rds_connection_timing_configuration.acquireTimeoutMillis / 1000) + 60
}

resource "aws_iam_role" "sf_event_sqs_to_db_records_lambda" {
  name                 = "${var.prefix}_sf_event_sqs_to_db_records_lambda_role"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
  tags                 = var.tags
}

data "aws_iam_policy_document" "sf_event_sqs_to_db_records_lambda" {
  statement {
    actions = [
      "states:DescribeExecution",
      "states:GetExecutionHistory"
    ]
    resources = ["*"]
  }

  statement {
    actions   = [
      "s3:GetObject",
      "s3:PutObject"
    ]
    resources = ["arn:aws:s3:::${var.system_bucket}/*"]
  }

  statement {
    actions   = [
      "s3:ListBucket"
    ]
    resources = ["arn:aws:s3:::${var.system_bucket}"]
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
      "s3:ListBucket*"
    ]
    resources = [for b in local.allowed_buckets: "arn:aws:s3:::${b}"]
  }

  statement {
    actions = [
      "s3:GetObject*",
    ]
    resources = [for b in local.allowed_buckets: "arn:aws:s3:::${b}/*"]
  }

  statement {
    actions = [
      "sqs:GetQueueUrl",
      "sqs:GetQueueAttributes",
      "sqs:SendMessage",
    ]
    resources = ["arn:aws:sqs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:${var.prefix}-sfEventSqsToDbRecordsInputQueue"]
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
      aws_sqs_queue.sf_event_sqs_to_db_records_input_queue.arn,
      aws_sqs_queue.sf_event_sqs_to_db_records_dead_letter_queue.arn
    ]
  }

  statement {
    actions = [
      "secretsmanager:GetSecretValue"
    ]
    resources = [var.rds_user_access_secret_arn]
  }

  statement {
    actions   = ["sns:Publish"]
    resources = [
      aws_sns_topic.report_executions_topic.arn,
      aws_sns_topic.report_granules_topic.arn,
      aws_sns_topic.report_pdrs_topic.arn
    ]
  }

}

resource "aws_iam_role_policy" "sf_event_sqs_to_db_records_lambda_role_policy" {
  name   = "${var.prefix}_sf_event_sqs_to_db_records_lambda_role_policy"
  role   = aws_iam_role.sf_event_sqs_to_db_records_lambda.id
  policy = data.aws_iam_policy_document.sf_event_sqs_to_db_records_lambda.json
}

resource "aws_sqs_queue" "sf_event_sqs_to_db_records_input_queue" {
  name                       = "${var.prefix}-sfEventSqsToDbRecordsInputQueue"
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = (local.sf_event_sqs_lambda_timeout * 6)
  redrive_policy = jsonencode(
    {
      deadLetterTargetArn = aws_sqs_queue.sf_event_sqs_to_db_records_dead_letter_queue.arn
      maxReceiveCount     = 10
  })
  tags = var.tags
}

data "aws_iam_policy_document" "sf_event_sqs_send_message_policy" {
  statement {
    actions   = ["sqs:sendMessage"]
    resources = [aws_sqs_queue.sf_event_sqs_to_db_records_input_queue.arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_sqs_queue_policy" "sf_event_sqs_to_db_records_input_queue_policy" {
  queue_url = aws_sqs_queue.sf_event_sqs_to_db_records_input_queue.id
  policy    = data.aws_iam_policy_document.sf_event_sqs_send_message_policy.json
}

resource "aws_lambda_event_source_mapping" "sf_event_sqs_to_db_records_mapping" {
  event_source_arn = aws_sqs_queue.sf_event_sqs_to_db_records_input_queue.arn
  function_name    = aws_lambda_function.sf_event_sqs_to_db_records.arn
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_sqs_queue" "sf_event_sqs_to_db_records_dead_letter_queue" {
  name                       = "${var.prefix}-sfEventSqsToDbRecordsDeadLetterQueue"
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = (local.sf_event_sqs_lambda_timeout * 6)
  tags                       = var.tags
}

resource "aws_lambda_function" "sf_event_sqs_to_db_records" {
  filename         = "${path.module}/../../packages/api/dist/sfEventSqsToDbRecords/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/sfEventSqsToDbRecords/lambda.zip")
  function_name    = "${var.prefix}-sfEventSqsToDbRecords"
  role             = aws_iam_role.sf_event_sqs_to_db_records_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs16.x"
  timeout          = local.sf_event_sqs_lambda_timeout
  memory_size      = lookup(var.lambda_memory_sizes, "sfEventSqsToDbRecords", 1024)

  dead_letter_config {
    target_arn = aws_sqs_queue.sf_event_sqs_to_db_records_dead_letter_queue.arn
  }

  environment {
    variables = {
      acquireTimeoutMillis           = var.rds_connection_timing_configuration.acquireTimeoutMillis
      createRetryIntervalMillis      = var.rds_connection_timing_configuration.createRetryIntervalMillis
      createTimeoutMillis            = var.rds_connection_timing_configuration.createTimeoutMillis
      databaseCredentialSecretArn    = var.rds_user_access_secret_arn
      DeadLetterQueue                = aws_sqs_queue.sf_event_sqs_to_db_records_dead_letter_queue.id
      execution_sns_topic_arn        = aws_sns_topic.report_executions_topic.arn
      granule_sns_topic_arn          = aws_sns_topic.report_granules_topic.arn
      idleTimeoutMillis              = var.rds_connection_timing_configuration.idleTimeoutMillis
      pdr_sns_topic_arn              = aws_sns_topic.report_pdrs_topic.arn
      RDS_DEPLOYMENT_CUMULUS_VERSION = "9.0.0"
      reapIntervalMillis             = var.rds_connection_timing_configuration.reapIntervalMillis
      ES_HOST                        = var.elasticsearch_hostname
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = concat(local.lambda_security_group_ids, [var.rds_security_group])
    }
  }

  tags = var.tags
}

resource "aws_lambda_event_source_mapping" "db_records_dlq_to_s3_mapping" {
  event_source_arn = aws_sqs_queue.sf_event_sqs_to_db_records_dead_letter_queue.arn
  function_name    = aws_lambda_function.write_db_dlq_records_to_s3.arn
}

resource "aws_lambda_function" "write_db_dlq_records_to_s3" {
  filename         = "${path.module}/../../packages/api/dist/writeDbDlqRecordstoS3/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/writeDbDlqRecordstoS3/lambda.zip")
  function_name    = "${var.prefix}-writeDbRecordsDLQtoS3"
  role             = aws_iam_role.sf_event_sqs_to_db_records_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs16.x"
  timeout          = local.sf_event_sqs_lambda_timeout
  memory_size      = lookup(var.lambda_memory_sizes, "writeDbRecordsDLQtoS3", 512)

  environment {
    variables = {
      stackName     = var.prefix
      system_bucket = var.system_bucket
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = compact([
        aws_security_group.no_ingress_all_egress[0].id,
        var.rds_security_group
      ])
    }
  }

  tags = var.tags
}

