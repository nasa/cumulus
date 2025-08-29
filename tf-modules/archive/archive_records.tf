resource "aws_sqs_queue" "archive_records_dead_letter_queue" {
  name                       = "${var.prefix}-archiveRecordsDeadLetterQueue"
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 60

  tags = var.tags
}

resource "aws_lambda_function" "archive_records" {
  function_name    = "${var.prefix}-archiveRecords"
  filename         = "${path.module}/../../tasks/archive-records/dist/lambda.zip"
source_code_hash = filebase64sha256("${path.module}/../../tasks/archive-records/dist/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs20.x"
  timeout          = lookup(var.lambda_timeouts, "archiveRecords", 900)
  memory_size      = lookup(var.lambda_memory_sizes, "archiveRecords", 128)
  dead_letter_config {
    target_arn = aws_sqs_queue.archive_records_dead_letter_queue.arn
  }
  environment {
    variables = {
      stackName = var.prefix
      BATCH_SIZE = var.
    }
  }

  tags = var.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = local.lambda_security_group_ids
    }
  }
}

resource "aws_cloudwatch_event_rule" "daily_archive_records" {
  name = "${var.prefix}_daily_archive_records"
  schedule_expression = var.daily_archive_records_schedule_expression
  tags                = var.tags
}

resource "aws_cloudwatch_event_target" "daily_archive_records" {
  target_id = "archive_records_lambda_target"
  rule = aws_cloudwatch_event_rule.daily_archive_records.name
  arn  = aws_lambda_function.archive_records.arn
}

resource "aws_lambda_permission" "daily_archive_records" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.archive_records.arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_archive_records.arn
}
