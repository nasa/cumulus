locals {
  enable_point_in_time_table_names = [for x in var.enable_point_in_time_tables : "${var.prefix}-${x}"]
  es_domain_name = "${var.prefix}-${var.elasticsearch_config.domain_name}"
  table_names = {
    access_tokens_table    = "${var.prefix}-AccessTokensTable"
    async_operations_table = "${var.prefix}-AsyncOperationsTable"
    collections_table      = "${var.prefix}-CollectionsTable"
    executions_table       = "${var.prefix}-ExecutionsTable"
    files_table            = "${var.prefix}-FilesTable"
    granules_table         = "${var.prefix}-GranulesTable"
    pdrs_table             = "${var.prefix}-PdrsTable"
    providers_table        = "${var.prefix}-ProvidersTable"
    rules_table            = "${var.prefix}-RulesTable"
    semaphores_table       = "${var.prefix}-SemaphoresTable"
    users_table            = "${var.prefix}-UsersTable"
  }
}

resource "aws_dynamodb_table" "access_tokens_table" {
  name             = local.table_names.access_tokens_table
  read_capacity    = 5
  write_capacity   = 1
  hash_key         = "accessToken"

  attribute {
    name = "accessToken"
    type = "S"
  }

  point_in_time_recovery {
    enabled = contains(local.enable_point_in_time_table_names, local.table_names.access_tokens_table)
  }
}

resource "aws_dynamodb_table" "async_operations_table" {
  name             = local.table_names.async_operations_table
  read_capacity    = 5
  write_capacity   = 10
  hash_key         = "id"

  attribute {
    name = "id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = contains(local.enable_point_in_time_table_names, local.table_names.async_operations_table)
  }
}

resource "aws_dynamodb_table" "collections_table" {
  name             = "${var.prefix}-CollectionsTable"
  read_capacity    = 5
  write_capacity   = 1
  hash_key         = "name"
  range_key        = "version"
  stream_enabled   = true
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
    enabled = contains(local.enable_point_in_time_table_names, local.table_names.collections_table)
  }
}

resource "aws_dynamodb_table" "executions_table" {
  name             = local.table_names.executions_table
  read_capacity    = 5
  write_capacity   = 10
  hash_key         = "arn"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "arn"
    type = "S"
  }

  point_in_time_recovery {
    enabled = contains(local.enable_point_in_time_table_names, local.table_names.executions_table)
  }
}

resource "aws_dynamodb_table" "files_table" {
  name             = local.table_names.files_table
  read_capacity    = 5
  write_capacity   = 10
  hash_key         = "bucket"
  range_key        = "key"
  stream_enabled   = true
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
    enabled = contains(local.enable_point_in_time_table_names, local.table_names.files_table)
  }
}

resource "aws_dynamodb_table" "granules_table" {
  name             = local.table_names.granules_table
  read_capacity    = 5
  write_capacity   = 10
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
    name               = "collectionId-granuleId-index"
    hash_key           = "collectionId"
    range_key          = "granuleId"
    read_capacity      = 5
    write_capacity     = 10
    projection_type    = "ALL"
  }

  point_in_time_recovery {
    enabled = contains(local.enable_point_in_time_table_names, local.table_names.granules_table)
  }
}

resource "aws_dynamodb_table" "pdrs_table" {
  name             = local.table_names.pdrs_table
  read_capacity    = 5
  write_capacity   = 2
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
}

resource "aws_dynamodb_table" "providers_table" {
  name             = local.table_names.providers_table
  read_capacity    = 5
  write_capacity   = 1
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
}

resource "aws_dynamodb_table" "rules_table" {
  name             = local.table_names.rules_table
  read_capacity    = 5
  write_capacity   = 1
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
}

resource "aws_dynamodb_table" "semaphores_table" {
  name             = local.table_names.semaphores_table
  read_capacity    = 5
  write_capacity   = 10
  hash_key         = "name"

  attribute {
    name = "name"
    type = "S"
  }

  point_in_time_recovery {
    enabled = contains(local.enable_point_in_time_table_names, local.table_names.semaphores_table)
  }
}

resource "aws_dynamodb_table" "users_table" {
  name             = local.table_names.users_table
  read_capacity    = 5
  write_capacity   = 1
  hash_key         = "userName"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "userName"
    type = "S"
  }

  point_in_time_recovery {
    enabled = contains(local.enable_point_in_time_table_names, local.table_names.users_table)
  }
}

data "aws_region" "current" {}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "es_access_policy" {
  statement {
    actions = [
      "es:*"
    ]

    principals {
      type        = "AWS"
      identifiers = var.es_role_arns
    }

    resources = [
      "arn:aws:es:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:domain/${local.es_domain_name}/*"
    ]
  }
}

resource "aws_elasticsearch_domain" "es" {
  count                 = var.include_elasticsearch ? 1 : 0
  domain_name           = local.es_domain_name
  elasticsearch_version = var.elasticsearch_config.version
  access_policies       = data.aws_iam_policy_document.es_access_policy.json

  cluster_config {
    instance_type = var.elasticsearch_config.instance_type
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp2"
    volume_size = var.elasticsearch_config.volume_size
  }

  advanced_options = {
    "rest.action.multi.allow_explicit_index" = "true"
  }

  snapshot_options {
    automated_snapshot_start_hour = 0
  }
}
