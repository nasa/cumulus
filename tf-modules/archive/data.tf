# AWS provider
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# DynamoDB tables

data "aws_dynamodb_table" "collections" {
  name = var.dynamo_tables.Collections
}

data "aws_dynamodb_table" "executions" {
  name = var.dynamo_tables.Executions
}

data "aws_dynamodb_table" "granules" {
  name = var.dynamo_tables.Granules
}

data "aws_dynamodb_table" "pdrs" {
  name = var.dynamo_tables.Pdrs
}

data "aws_dynamodb_table" "providers" {
  name = var.dynamo_tables.Providers
}

data "aws_dynamodb_table" "rules" {
  name = var.dynamo_tables.Rules
}

# Lambda functions

data "aws_lambda_function" "kinesis_inbound_event_logger" {
  function_name = var.kinesis_inbound_event_logger
}
