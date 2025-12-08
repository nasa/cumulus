# Background Processing Watcher

resource "aws_cloudwatch_event_rule" "background_processing_watcher" {
  name = "${var.prefix}_background_processing_watcher"
  schedule_expression = "rate(1 minute)"
  tags                = var.tags
}

resource "aws_cloudwatch_event_target" "background_processing_watcher" {
  target_id = "throttle_lambda_target"
  rule = aws_cloudwatch_event_rule.background_processing_watcher.name
  arn  = aws_lambda_function.sqs2sfThrottle.arn
  input = jsonencode({
    messageLimit = var.sf_start_rate == null ? 500 : var.sf_start_rate
    queueUrl     = aws_sqs_queue.background_processing.id
    timeLimit    = 60
  })
}

resource "aws_lambda_permission" "background_processing_watcher" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sqs2sfThrottle.arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.background_processing_watcher.arn
}

# Schedule SF

resource "aws_lambda_permission" "generic_lambda" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.schedule_sf.arn
  principal     = "events.amazonaws.com"
}

# sqsMessageConsumer Watcher

resource "aws_cloudwatch_event_rule" "sqs_message_consumer_watcher" {
  name = "${var.prefix}_sqs_message_consumer_watcher"
  schedule_expression = "rate(1 minute)"
  tags                = var.tags
}

resource "aws_cloudwatch_event_target" "sqs_message_consumer_watcher" {
  target_id = "sqs_consumer_target"
  rule = aws_cloudwatch_event_rule.sqs_message_consumer_watcher.name
  arn  = aws_lambda_function.sqs_message_consumer.arn
  input = jsonencode({
    messageLimit = var.sqs_message_consumer_watcher_message_limit
    timeLimit    = var.sqs_message_consumer_watcher_time_limit
  })
}

resource "aws_lambda_permission" "sqs_message_consumer_watcher" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sqs_message_consumer.arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.sqs_message_consumer_watcher.arn
}
