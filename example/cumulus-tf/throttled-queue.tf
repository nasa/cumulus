resource "aws_sqs_queue" "throttled_queue" {
  name                       = "${var.prefix}-ThrottledQueue"
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = 60
}


resource "aws_cloudwatch_event_rule" "throttled_queue_watcher" {
  name                = "${var.prefix}-throttled_queue_watcher"
  schedule_expression = "rate(1 minute)"
    lifecycle {
      create_before_destroy = true
    }
}

resource "aws_cloudwatch_event_target" "throttled_queue_watcher" {
  rule = aws_cloudwatch_event_rule.throttled_queue_watcher.name
  arn  = module.cumulus.sqs2sfThrottle_lambda_function_arn
  input = jsonencode({
    messageLimit = 500
    queueUrl     = aws_sqs_queue.throttled_queue.id
    timeLimit    = 60
  })
}

resource "aws_lambda_permission" "throttled_queue_watcher" {
  action        = "lambda:InvokeFunction"
  function_name = module.cumulus.sqs2sfThrottle_lambda_function_arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.throttled_queue_watcher.arn
}
