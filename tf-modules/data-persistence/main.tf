provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

resource "aws_dynamodb_table" "access_tokens_table" {
  name             = "${var.prefix}-AccessTokensTable"
  read_capacity    = 5
  write_capacity   = 1
  hash_key         = "accessToken"
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "accessToken"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.enable_point_in_time_recovery
  }
}

resource "aws_dynamodb_table" "async_operations_table" {
  name             = "${var.prefix}-AsyncOperationsTable"
  read_capacity    = 5
  write_capacity   = 1
  hash_key         = "id"
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.enable_point_in_time_recovery
  }
}

resource "aws_dynamodb_table" "collections_table" {
  name             = "${var.prefix}-CollectionsTable"
  read_capacity    = 5
  write_capacity   = 1
  hash_key         = "name"
  range_key        = "version"
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "name"
    type = "S"
  }

  attribute {
    name = "version"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.enable_point_in_time_recovery
  }
}
