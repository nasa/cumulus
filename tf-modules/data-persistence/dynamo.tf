locals {
  enable_point_in_time_table_names = [for x in var.enable_point_in_time_tables : "${var.prefix}-${x}"]
  table_names = {
    access_tokens_table          = "${var.prefix}-AccessTokensTable"
    semaphores_table             = "${var.prefix}-SemaphoresTable"
  }
}

resource "aws_dynamodb_table" "access_tokens_table" {
  name         = local.table_names.access_tokens_table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "accessToken"

  attribute {
    name = "accessToken"
    type = "S"
  }

  ttl {
    attribute_name = "expirationTime"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = contains(local.enable_point_in_time_table_names, local.table_names.access_tokens_table)
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes = [ name ]
  }

  tags = var.tags
}

resource "aws_dynamodb_table" "semaphores_table" {
  name         = local.table_names.semaphores_table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "key"

  attribute {
    name = "key"
    type = "S"
  }

  point_in_time_recovery {
    enabled = contains(local.enable_point_in_time_table_names, local.table_names.semaphores_table)
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes = [ name ]
  }

  tags = var.tags
}
