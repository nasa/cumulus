output "granule_sns_arn" {
  value = aws_sns_topic.report_pdrs_topic.arn
}
