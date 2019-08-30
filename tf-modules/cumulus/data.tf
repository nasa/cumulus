# AWS provider

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Dynamo tables

data "aws_dynamodb_table" "async_operations" {
  name = var.dynamo_tables.AsyncOperations
}
