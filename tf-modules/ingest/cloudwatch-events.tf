# Background Processing Watcher

resource "aws_cloudwatch_event_rule" "background_processing_watcher" {
  schedule_expression = "rate(1 minute)"
  tags                = local.default_tags
}

resource "aws_cloudwatch_event_target" "background_processing_watcher" {
  rule = aws_cloudwatch_event_rule.background_processing_watcher.name
  arn  = aws_lambda_function.sqs2sfThrottle.arn
  input = jsonencode({
    messageLimit = var.sf_start_rate ? var.sf_start_rate : 500
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

# StartSF Watcher

resource "aws_cloudwatch_event_rule" "start_sf_watcher" {
  schedule_expression = "rate(1 minute)"
  tags                = local.default_tags
}

resource "aws_cloudwatch_event_target" "start_sf_watcher" {
  rule = aws_cloudwatch_event_rule.start_sf_watcher.name
  arn  = aws_lambda_function.sqs2sf.arn
  input = jsonencode({
    messageLimit = var.sf_start_rate ? var.sf_start_rate : 500
    queueUrl     = aws_sqs_queue.start_sf.id
    timeLimit    = 60
  })
}

resource "aws_lambda_permission" "start_sf_watcher" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sqs2sf.arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.start_sf_watcher.arn
}
