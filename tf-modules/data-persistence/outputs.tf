output "dynamo_tables" {
  value = {
    access_tokens = {
      name = aws_dynamodb_table.access_tokens_table.name,
      arn  = aws_dynamodb_table.access_tokens_table.arn
    }
    reconciliation_reports = {
      name = aws_dynamodb_table.reconciliation_reports_table.name
      arn  = aws_dynamodb_table.reconciliation_reports_table.arn
    }
    semaphores = {
      name = aws_dynamodb_table.semaphores_table.name
      arn  = aws_dynamodb_table.semaphores_table.arn
    }
  }
}
