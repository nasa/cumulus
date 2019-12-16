terraform {
  required_providers {
    aws = ">= 2.31.0"
  }
}

locals {
  destination_arn =  var.log_destination_arn != null && var.logs_to_metrics ? var.log_destination_arn : var.log2elasticsearch_lambda_function_arn
}
