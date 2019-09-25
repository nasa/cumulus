locals {
  all_bucket_names       = [for k, v in var.buckets : v.name]
  private_bucket_names   = [for k, v in var.buckets : v.name if v.type == "private"]
  protected_bucket_names = [for k, v in var.buckets : v.name if v.type == "protected"]
  public_bucket_names    = [for k, v in var.buckets : v.name if v.type == "public"]

  default_tags = { Deployment = var.prefix }
}

resource "aws_s3_bucket_object" "buckets_json" {
  bucket  = var.system_bucket
  key     = "${var.prefix}/workflows/buckets.json"
  content = jsonencode(var.buckets)
  etag    = md5(jsonencode(var.buckets))
}
