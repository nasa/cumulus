locals {
  task_root      = "${path.module}/../"
  zip_subdir     = "dist/final/lambda.zip"
  subnet_id_name = "Private application ${data.aws_region.current.name}a subnet"
}

check "subnet_id_exists" {
  assert {
    condition     = length(data.aws_subnets.subnet_ids.ids) > 0
    error_message = format("No subnets found that match %s. Update your subnet configuration.", local.subnet_id_name)
  }
}

data "aws_region" "current" {}

data "aws_subnets" "subnet_ids" {
  tags = {
    Name = local.subnet_id_name
    # eg "Private application us-west-2a subnet"
  }
}

module "get_cnm_task" {
  source            = "../../../tf-modules/cumulus-task"
  name              = "GetCnm"
  prefix            = var.prefix
  role              = var.lambda_processing_role_arn
  lambda_zip_path   = abspath("${local.task_root}/${local.zip_subdir}")
  subnet_ids        = data.aws_subnets.subnet_ids.ids
  security_group_id = var.security_group_id
  timeout           = var.lambda_timeout
  memory_size       = var.lambda_memory_size
  tags              = var.tags
  environment = {
    PRIVATE_API_LAMBDA_ARN = var.private_api_lambda_arn
  }
}
