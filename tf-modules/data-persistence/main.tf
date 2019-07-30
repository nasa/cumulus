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
  write_capacity   = 10
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

resource "aws_dynamodb_table" "executions_table" {
  name             = "${var.prefix}-ExecutionsTable"
  read_capacity    = 5
  write_capacity   = 10
  hash_key         = "arn"
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "arn"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.enable_point_in_time_recovery
  }
}

resource "aws_dynamodb_table" "files_table" {
  name             = "${var.prefix}-FilesTable"
  read_capacity    = 5
  write_capacity   = 10
  hash_key         = "bucket"
  range_key        = "key"
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "bucket"
    type = "S"
  }

  attribute {
    name = "key"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.enable_point_in_time_recovery
  }
}

resource "aws_dynamodb_table" "granules_table" {
  name             = "${var.prefix}-GranulesTable"
  read_capacity    = 5
  write_capacity   = 10
  hash_key         = "granuleId"
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
    name               = "collectionId-granuleId-index"
    hash_key           = "collectionId"
    range_key          = "granuleId"
    read_capacity      = 5
    write_capacity     = 10
    projection_type    = "ALL"
  }

  point_in_time_recovery {
    enabled = var.enable_point_in_time_recovery
  }
}

resource "aws_dynamodb_table" "pdrs_table" {
  name             = "${var.prefix}-PdrsTable"
  read_capacity    = 5
  write_capacity   = 2
  hash_key         = "pdrName"
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "pdrName"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.enable_point_in_time_recovery
  }
}

resource "aws_dynamodb_table" "providers_table" {
  name             = "${var.prefix}-ProvidersTable"
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

resource "aws_dynamodb_table" "rules_table" {
  name             = "${var.prefix}-RulesTable"
  read_capacity    = 5
  write_capacity   = 1
  hash_key         = "name"
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "name"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.enable_point_in_time_recovery
  }
}

resource "aws_dynamodb_table" "semaphores_table" {
  name             = "${var.prefix}-SemaphoresTable"
  read_capacity    = 5
  write_capacity   = 10
  hash_key         = "name"
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "name"
    type = "S"
  }

  point_in_time_recovery {
    enabled = false
  }
}

resource "aws_dynamodb_table" "users_table" {
  name             = "${var.prefix}-UsersTable"
  read_capacity    = 5
  write_capacity   = 1
  hash_key         = "userName"
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "userName"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.enable_point_in_time_recovery
  }
}
