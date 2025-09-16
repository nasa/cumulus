resource "aws_cloudwatch_event_rule" "daily_archive_records" {
  name = "${var.prefix}_daily_archive_records"
  schedule_expression = var.daily_archive_records_schedule_expression
  tags                = var.tags
}

resource "aws_cloudwatch_event_target" "daily_archive_records" {
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
resource "aws_cloudwatch_event_target" "daily_archive_records" {
  target_id = "archive_exections_lambda_target"
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
