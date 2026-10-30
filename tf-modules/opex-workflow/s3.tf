
resource "aws_s3_bucket" "standard-bucket" {
  for_each = local.standard_bucket_names

  bucket = each.key
  lifecycle {
    prevent_destroy = true
    ignore_changes = [
      lifecycle_rule,
      logging,
      versioning
    ]
  }
  tags = local.dar_yes_tags
}

resource "aws_s3_bucket_server_side_encryption_configuration" "standard_bucket_encryption_configuration" {
  for_each = toset(local.standard_bucket_names)

  bucket = each.key

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# protected buckets log to "internal"
resource "aws_s3_bucket" "protected-bucket" {
  # protected buckets defined in variables.tf
  for_each = local.protected_bucket_names
  bucket   = each.key
  lifecycle {
    prevent_destroy = true
    # This prevents the cors_rule from being defined in the aws_s3_bucket.
    # The cors_rule in the resource aws_s3_bucket is to be removed in a later AWS Provider Version
    # https://registry.terraform.io/providers/hashicorp/aws/3.76.1/docs/resources/s3_bucket_cors_configuration#usage-notes
    ignore_changes = [
      cors_rule,
      lifecycle_rule,
      logging,
      versioning
    ]
  }
  tags = local.dar_no_tags
}

resource "aws_s3_bucket_server_side_encryption_configuration" "protected_bucket_encryption_configuration" {
  for_each = toset(local.protected_bucket_names)

  bucket = each.key
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "protected-buckets" {
  for_each = local.protected_bucket_names
  bucket   = each.key
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["null"]
    max_age_seconds = 3000
  }
}

# public buckets log to "internal"
resource "aws_s3_bucket" "public-bucket" {
  # public buckets defined in variables.tf
  for_each = local.public_bucket_names
  bucket   = each.key

  lifecycle {
    prevent_destroy = true
    # This prevents the cors_rule from being defined in the aws_s3_bucket.
    # The cors_rule in the resource aws_s3_bucket is to be removed in a later AWS Provider Version
    # https://registry.terraform.io/providers/hashicorp/aws/3.76.1/docs/resources/s3_bucket_cors_configuration#usage-notes
    ignore_changes = [
      cors_rule,
      lifecycle_rule,
      logging,
      versioning
    ]
  }
  tags = local.dar_no_tags
}

resource "aws_s3_bucket_cors_configuration" "public-buckets" {
  for_each = local.public_bucket_names
  bucket   = each.key
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["null"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "public_bucket_encryption_configuration" {
  for_each = toset(local.public_bucket_names)

  bucket = each.key

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "workflow_bucket_encryption_configuration" {
  for_each = toset(local.workflow_bucket_names)

  bucket = each.key

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket" "workflow-bucket" {
  for_each = local.workflow_bucket_names

  bucket = each.key
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [logging]
  }
  tags = local.dar_no_tags
}
