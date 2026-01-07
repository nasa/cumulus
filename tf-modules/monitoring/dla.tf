locals {
  db_prefix           = replace("${var.prefix}", "-", "_")
  glue_database_name  = "${local.db_prefix}_glue_database"
  dla_glue_table_name = "${local.db_prefix}_dla_glue_table"
  dla_glue_table_s3_location = "s3://${var.system_bucket}/${var.prefix}/dead-letter-archive/sqs"
  athena_workgroup    = "${local.db_prefix}_athena_workgroup"
  athena_query_output_location = "s3://${var.system_bucket}/${var.prefix}/athena/query_output/"
  current_date        = formatdate("YYYY-MM-DD", timestamp())
  athena_test_query_name = "${local.db_prefix}_athena_test_query"
}

resource "aws_glue_catalog_database" "glue_database" {
  name = local.glue_database_name
}

resource "aws_glue_catalog_table" "dla_glue_table" {
  name          = local.dla_glue_table_name
  database_name = aws_glue_catalog_database.glue_database.name
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    classification                       = "json"
    "projection.enabled"                 = true
    "projection.eventdate.type"          = "date"
    "projection.eventdate.format"        = "yyyy-MM-dd"
    "projection.eventdate.range"         = "2010-01-01,NOW"
    "projection.eventdate.interval"      = "1"
    "projection.eventdate.interval.unit" = "DAYS"
    "storage.location.template"          = "${local.dla_glue_table_s3_location}/$${eventdate}/"
  }

  storage_descriptor {
    location      = local.dla_glue_table_s3_location
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      name                  = "ser_de_name"
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"

      parameters = {
        "serialization.format" = 1
      }
    }

    columns {
      name = "executionarn"
      type = "string"
    }
    columns {
      name = "granules"
      type = "array<string>"
    }
    columns {
      name = "collectionid"
      type = "string"
    }
    columns {
      name = "providerid"
      type = "string"
    }
    columns {
      name = "status"
      type = "string"
    }
    columns {
      name = "statemachinearn"
      type = "string"
    }
    columns {
      name = "error"
      type = "string"
    }
    columns {
      name = "time"
      type = "timestamp"
    }
    columns {
      name = "messageid"
      type = "string"
    }
    columns {
      name = "body"
      type = "string"
    }
    columns {
      name = "attributes"
      type = "struct<ApproximateReceiveCount:string,SentTimestamp:string,SenderId:string,ApproximateFirstReceiveTimestamp:string>"
    }
    columns {
      name = "eventsourcearn"
      type = "string"
    }
  }

  partition_keys {
    name = "eventdate"
    type = "string"
  }
}

resource "aws_athena_workgroup" "athena_workgroup" {
  name = local.athena_workgroup

  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true

    result_configuration {
      output_location = local.athena_query_output_location

      encryption_configuration {
        encryption_option = "SSE_S3"
      }
    }
  }
  force_destroy = true
}

resource "aws_athena_named_query" "athena_test_query" {
  name        = local.athena_test_query_name
  workgroup   = aws_athena_workgroup.athena_workgroup.id
  database    = local.glue_database_name
  query       = "SELECT * FROM ${local.dla_glue_table_name} where eventdate = '${local.current_date}' limit 1;"
}
