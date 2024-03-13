locals {
  db_prefix             = replace("${var.prefix}", "-", "_")
  athena_database_name  = "${local.db_prefix}_athena_database"
  dla_athena_table_name = "${local.db_prefix}_dla_athena_table"
  dla_athena_table_s3_location = "s3://${var.system_bucket}/${var.prefix}/glue/databases/${local.athena_database_name}/${local.dla_athena_table_name}"
  dla_glub_etl_job_name = "${var.prefix}_dla_glub_etl_job"
  dla_s3_bucket_path    = "s3://${var.system_bucket}/${var.prefix}/dead-letter-archive/"
  dla_etl_script_file = templatefile("${path.module}/dla_etl_script_template.py", {
    athena_database      = local.athena_database_name
    athena_table         = local.dla_athena_table_name
    s3_bucket_path       = local.dla_s3_bucket_path
    // TBD with /
    // rename all parameters
    // timestamp?
    s3_json_files_prefix = "sqs2/"
    time_field           = "timestamp"
  })
  dla_glue_etl_script_s3_key = "${var.prefix}/glue/scripts/dla_etl_script.py"
}

resource "aws_glue_catalog_database" "athena_database" {
  name = local.athena_database_name
}

resource "aws_glue_catalog_table" "dla_athena_table" {
  name          = local.dla_athena_table_name
  database_name = aws_glue_catalog_database.athena_database.name
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    EXTERNAL               = "TRUE"
    "classification"       = "json"
    //"useGlueParquetWriter" = "TRUE"
  }

  storage_descriptor {
      location      = local.dla_athena_table_s3_location
      input_format  = "org.apache.hadoop.mapred.TextInputFormat"
      output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

      ser_de_info {
          name                  = "ser_de_name"
          serialization_library = "org.openx.data.jsonserde.JsonSerDe"

          parameters = {
            //"serialization.format" = 1
          }
      }

      columns {
          name = "receipthandle"
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
          name = "messageattributes"
          type = "string"
      }
      columns {
          name = "md5ofbody"
          type = "string"
      }
      columns {
          name = "eventsource"
          type = "string"
      }
      columns {
          name = "eventsourcearn"
          type = "string"
      }
      columns {
          name = "awsregion"
          type = "string"
      }
      stored_as_sub_directories = false
  }

  partition_keys {
      name = "messageId"
      type = "string"
  }
}

resource "aws_s3_object" "dla_etl_script_s3" {
  bucket = var.system_bucket
  key = local.dla_glue_etl_script_s3_key
  content = local.dla_etl_script_file
  etag = md5(local.dla_etl_script_file)
  // TBD
  //tags    = var.tags
}

resource "aws_glue_job" "dla_etl_job" {
  name          = local.dla_glub_etl_job_name
  role_arn      = aws_iam_role.glue_service_role.arn
  glue_version = "4.0"
  worker_type = "G.1X" 
  number_of_workers = 2
  command {
    name        = "glueetl"
    python_version = "3"
    script_location = "s3://${var.system_bucket}/jl-rds-tf/glue/scripts/dla_etl_script.py"
  }
  default_arguments = {
    "--conf": "spark.yarn.executor.memoryOverhead=8192"
  }
}

// run
# resource "aws_glue_trigger" "example" {
#   name   = "example"
#   type   = "ON_DEMAND"
#   actions {
#     job_name = aws_glue_job.dla_etl_job.name
#   }
# }
