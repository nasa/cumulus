resource "aws_lambda_event_source_mapping" "start_sf_mapping" {
  event_source_arn = aws_sqs_queue.start_sf.arn
  function_name    = aws_lambda_function.sqs2sf.arn
}
