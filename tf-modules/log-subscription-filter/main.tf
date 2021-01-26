terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 2.31.0"
    }
  }
}

locals {
  destination_arn = var.log_destination_arn != null ? var.log_destination_arn : var.log2elasticsearch_lambda_function_arn
}
