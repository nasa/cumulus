data "aws_s3_bucket" "system_bucket" {
  bucket = var.system_bucket
}

resource "aws_s3_bucket_lifecycle_configuration" "system_bucket_lifecycle_config" {
  bucket = data.aws_s3_bucket.system_bucket.id
  
  dynamic "rule" {
    for_each = var.aws_s3_bucket_lifecycle_rules
    content {
      id     = "${var.prefix}_{rule.value.id}"
      filter {
        prefix = "${var.prefix}${var.value.prefix}"
      }
      expiration {
          days = rule.value.days
      }
      status = "Enabled"
    }
  }
}
