resource "aws_lambda_function" "archive_records" {
  function_name    = "${var.prefix}-ArchiveRecords"
  filename         = "${path.module}/../../tasks/archive-records/dist/webpack/lambda.zip"
source_code_hash = filebase64sha256("${path.module}/../../tasks/archive-records/dist/webpack/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs20.x"
  timeout          = lookup(var.lambda_timeouts, "ArchiveRecords", 900)
  memory_size      = lookup(var.lambda_memory_sizes, "ArchiveRecords", 128)
  dead_letter_config {
    target_arn = aws_sqs_queue.archive_records_dead_letter_queue.arn
  }
  environment {
    variables = {
      stackName    = var.prefix
      BATCH_SIZE = var.archive_batch_size
      EXPIRATION_DAYS = var.archive_expiration_days
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

resource "aws_cloudwatch_event_target" "daily_archive_granules" {
  target_id = "archive_granules_lambda_target"
  rule = aws_cloudwatch_event_rule.daily_archive_records.name
  arn  = aws_lambda_function.private_api.arn

  input = <<JSON
  {
    "httpMethod": "PATCH",
    "resource": "/{proxy+}",
    "headers": {
      "Content-Type": "application/json"
    },
    "path": "/granules/archive",
    "body": "{}"
  }
  JSON
}
resource "aws_cloudwatch_event_target" "daily_archive_executions" {
  target_id = "archive_executions_lambda_target"
  rule = aws_cloudwatch_event_rule.daily_archive_records.name
  arn  = aws_lambda_function.private_api.arn

  input = <<JSON
  {
    "httpMethod": "PATCH",
    "resource": "/{proxy+}",
    "headers": {
      "Content-Type": "application/json"
    },
    "path": "/executions/archive",
    "body": "{}"
  }
  JSON
}
resource "aws_lambda_permission" "daily_archive_records" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.private_api.arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_archive_records.arn
}
