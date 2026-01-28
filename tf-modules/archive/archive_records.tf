resource "aws_lambda_function" "archive_records" {
  function_name    = "${var.prefix}-ArchiveRecords"
  filename         = "${path.module}/../../packages/api/dist/archiveRecords/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/archiveRecords/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs22.x"
  timeout          = lookup(var.lambda_timeouts, "ArchiveRecords", 900)
  memory_size      = lookup(var.lambda_memory_sizes, "ArchiveRecords", 512)

  environment {
    variables = {
      stackName = var.prefix
      databaseCredentialSecretArn = var.rds_user_access_secret_arn
    }
  }
  tags = var.tags
  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = concat(local.lambda_security_group_ids, [var.rds_security_group])
    }
  }
}


resource "aws_cloudwatch_event_rule" "daily_archive_records" {
  count = var.archive_records_config.deploy_rule == true ? 1 : 0
  name = "${var.prefix}-daily-archive-records"
  schedule_expression = var.archive_records_config.schedule_expression
  tags                = var.tags
}

resource "aws_cloudwatch_event_target" "daily_archive_granules" {
  depends_on = [
    aws_cloudwatch_event_rule.daily_archive_records,
  ]
  count = var.archive_records_config.deploy_rule == true ? 1 : 0
  target_id = "archive_granules_lambda_target"
  rule = aws_cloudwatch_event_rule.daily_archive_records[count.index].name
  arn  = aws_lambda_function.private_api.arn

  input = <<JSON
  {
    "httpMethod": "POST",
    "resource": "/{proxy+}",
    "headers": {
      "Content-Type": "application/json"
    },
    "path": "/granules/bulkArchive",
    "body": "{\"updateLimit\": ${var.archive_records_config.update_limit},\"batchSize\": ${var.archive_records_config.batch_size},\"expirationDays\": ${var.archive_records_config.expiration_days}}"
  }
  JSON
}
resource "aws_cloudwatch_event_target" "daily_archive_executions" {
  depends_on = [
    aws_cloudwatch_event_rule.daily_archive_records,
  ]
  count = var.archive_records_config.deploy_rule == true ? 1 : 0
  target_id = "archive_executions_lambda_target"
  rule = aws_cloudwatch_event_rule.daily_archive_records[count.index].name
  arn  = aws_lambda_function.private_api.arn

  input = <<JSON
  {
    "httpMethod": "POST",
    "resource": "/{proxy+}",
    "headers": {
      "Content-Type": "application/json"
    },
    "path": "/executions/bulkArchive",
    "body": "{\"updateLimit\": ${var.archive_records_config.update_limit},\"batchSize\": ${var.archive_records_config.batch_size},\"expirationDays\": ${var.archive_records_config.expiration_days}}"
  }
  JSON
}
resource "aws_lambda_permission" "daily_archive_records" {
  depends_on = [
    aws_cloudwatch_event_rule.daily_archive_records,
  ]
  count = var.archive_records_config.deploy_rule == true ? 1 : 0
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.private_api.arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_archive_records[count.index].arn
}
