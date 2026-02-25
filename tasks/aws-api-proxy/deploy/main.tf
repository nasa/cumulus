locals {
  task_root = "${path.module}/../"
  zip_subdir = "dist/final/lambda.zip"
  subnet_id_name = "Private application ${data.aws_region.current}a subnet"

  # We may need to use this in the future if we don't have easy access to the role arn
  #lambda_processing_role_arn = one(data.aws_iam_roles.lambda_processing_role.arns)
}

# We may need to use this in the future if we don't have easy access to the role arn
#check "lambda_processing_role_exists" {
#  assert {
#    condition = length(data.aws_iam_roles.lambda_processing_role.arns) == 1
#    error_message = format("lambda_processing_role_pattern (%s) matched zero or more than one role.", var.lambda_processing_role_pattern)
#  }
#}

check "subnet_id_exists" {
  assert {
    condition = length(data.aws_subnets.subnet_ids.ids) > 0
    error_message = format("No subnets found that match %s. Update your subnet configuration.", local.subnet_id_name)
  }
}

data "aws_region" "current" {}

# We may need to use this in the future if we don't have easy access to the role arn
#data "aws_iam_roles" "lambda_processing_role" {
#  name_regex = var.lambda_processing_role_pattern
#}

data "aws_subnets" "subnet_ids" {
  tags = {
    Name = local.subnet_id_name
    # eg "Private application us-west-2a subnet"
  }
}

module "aws_api_proxy" {
    source = "../../../tf-modules/cumulus-task"
    name = "aws-api-proxy"
    prefix = var.prefix
    role = var.lambda_processing_role_arn
    lambda_zip_path = abspath("${local.task_root}/${local.zip_subdir}")
    subnet_ids = data.aws_subnets.subnet_ids.ids
    security_group_id = var.security_group_id
    timeout = var.lambda_timeout
    memory_size = var.lambda_memory_size
    tags = var.tags
}
