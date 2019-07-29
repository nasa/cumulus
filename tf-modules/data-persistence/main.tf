provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

resource "aws_dynamodb_table" "data_tables" {
  count          = length(var.table_names)
  name           = var.table_names[count.index]
}