output "s3_replicator_arn" {
  value = aws_lambda_function.s3_replicator.arn
  description = "Lambda ARN for the S3 replicator"
}
