locals {
  enable_point_in_time_table_names = [for x in var.enable_point_in_time_tables : "${var.prefix}-${x}"]
  table_names = {
    access_tokens_table          = "${var.prefix}-AccessTokensTable"
    async_operations_table       = "${var.prefix}-AsyncOperationsTable"
    executions_table             = "${var.prefix}-ExecutionsTable"
    granules_table               = "${var.prefix}-GranulesTable"
    pdrs_table                   = "${var.prefix}-PdrsTable"
    providers_table              = "${var.prefix}-ProvidersTable"
    reconciliation_reports_table = "${var.prefix}-ReconciliationReportsTable"
    rules_table                  = "${var.prefix}-RulesTable"
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

resource "aws_dynamodb_table" "async_operations_table" {
  name         = local.table_names.async_operations_table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = contains(local.enable_point_in_time_table_names, local.table_names.async_operations_table)
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes = [ name ]
  }

  tags = var.tags
}

resource "aws_dynamodb_table" "executions_table" {
  name             = local.table_names.executions_table
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "arn"

  attribute {
    name = "arn"
    type = "S"
  }

  point_in_time_recovery {
    enabled = contains(local.enable_point_in_time_table_names, local.table_names.executions_table)
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes = [ name ]
  }

  tags = var.tags
}

resource "aws_dynamodb_table" "granules_table" {
  name             = local.table_names.granules_table
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "granuleId"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "granuleId"
    type = "S"
  }

  attribute {
    name = "collectionId"
    type = "S"
  }

  global_secondary_index {
    name            = "collectionId-granuleId-index"
    hash_key        = "collectionId"
    range_key       = "granuleId"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = contains(local.enable_point_in_time_table_names, local.table_names.granules_table)
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes = [ name ]
  }

  tags = var.tags
}

resource "aws_dynamodb_table" "pdrs_table" {
  name             = local.table_names.pdrs_table
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "pdrName"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "pdrName"
    type = "S"
  }

  point_in_time_recovery {
    enabled = contains(local.enable_point_in_time_table_names, local.table_names.pdrs_table)
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes = [ name ]
  }

  tags = var.tags
}

resource "aws_dynamodb_table" "providers_table" {
  name             = local.table_names.providers_table
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "id"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = contains(local.enable_point_in_time_table_names, local.table_names.providers_table)
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes = [ name ]
  }

  tags = var.tags
}

resource "aws_dynamodb_table" "reconciliation_reports_table" {
  name             = local.table_names.reconciliation_reports_table
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "name"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "name"
    type = "S"
  }

  point_in_time_recovery {
    enabled = contains(local.enable_point_in_time_table_names, local.table_names.reconciliation_reports_table)
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes = [ name ]
  }

  tags = var.tags
}

resource "aws_dynamodb_table" "rules_table" {
  name             = local.table_names.rules_table
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "name"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "name"
    type = "S"
  }

  point_in_time_recovery {
    enabled = contains(local.enable_point_in_time_table_names, local.table_names.rules_table)
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
