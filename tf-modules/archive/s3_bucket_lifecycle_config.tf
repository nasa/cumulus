data "aws_s3_bucket" "system_bucket" {
  bucket = var.system_bucket
}

resource "aws_s3_bucket_lifecycle_configuration" "system_bucket_lifecycle_config" {
  bucket = data.aws_s3_bucket.system_bucket.id
  rule {
    id     = "${var.prefix}_expire_temporary_execution_status_files"
    filter {
      prefix = "${var.prefix}/data/execution-status/"
    }
    expiration {
        days = 1
    }
    status = "Enabled"
  }
}
