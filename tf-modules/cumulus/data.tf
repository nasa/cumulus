# AWS provider

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "aws_cloudformation_stack" "tea_stack" {
  name = var.tea_stack_name
}
