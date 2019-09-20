output "execution_sns_arn" {
  value = aws_sns_topic.report_executions_topic.arn
}
