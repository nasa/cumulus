resource "aws_dynamodb_table" "dedupe_granules" {
  name         = "${local.module_prefix}-DedupeGranules"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "DeduplicationId"

  attribute {
    name = "DeduplicationId"
    type = "S"
  }
}
