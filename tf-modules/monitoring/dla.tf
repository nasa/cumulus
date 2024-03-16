locals {
  db_prefix           = replace("${var.prefix}", "-", "_")
  glue_database_name  = "${local.db_prefix}_glue_database"
  dla_glue_table_name = "${local.db_prefix}_dla_glue_table"
  dla_glue_table_s3_location = "s3://${var.system_bucket}/${var.prefix}/dead-letter-archive/sqs"
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
      name = "executionArn"
      type = "string"
    }
    columns {
      name = "granules"
      type = "array<string>"
    }
    columns {
      name = "collectionId"
      type = "string"
    }
    columns {
      name = "providerId"
      type = "string"
    }
    columns {
      name = "status"
      type = "string"
    }
    columns {
      name = "stateMachineArn"
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
      name = "messageId"
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
      name = "eventSourceARN"
      type = "string"
    }
  }

  partition_keys {
    name = "eventdate"
    type = "string"
  }
}
