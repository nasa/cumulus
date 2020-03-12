# Kinesis fallback

resource "aws_sns_topic" "kinesis_fallback" {
  name = "${var.prefix}-kinesisFallback"
  tags = var.tags
}

resource "aws_sns_topic_subscription" "kinesis_fallback" {
  endpoint  = aws_lambda_function.fallback_consumer.arn
  protocol  = "lambda"
  topic_arn = aws_sns_topic.kinesis_fallback.arn
}

resource "aws_lambda_permission" "kinesis_fallback" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fallback_consumer.arn
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.kinesis_fallback.arn
}
