output "kinesis_inbound_event_logger_lambda_function_arn" {
  value = aws_lambda_function.kinesis_inbound_event_logger.arn
}

output "message_consumer_lambda_function_arn" {
  value = aws_lambda_function.message_consumer.arn
}

output "schedule_sf_lambda_function_arn" {
  value = aws_lambda_function.schedule_sf.arn
}
