data "aws_s3_bucket" "system_bucket" {
  bucket = var.system_bucket
}

resource "aws_s3_bucket_lifecycle_configuration" "system_bucket_lifecycle_config" {
  bucket = data.aws_s3_bucket.system_bucket.id

  dynamic "rule" {
    for_each = local.aws_s3_system_bucket_lifecycle_rules
    content {
      id     = "${var.prefix}_${rule.value.id}"
      filter {
        prefix = "${rule.value.prefix}"
      }
      expiration {
          days = rule.value.days
      }
      status = "${rule.value.status}"
    }
  }
}
