locals {
  task_root          = "${path.module}/../../tasks"
  zip_subdir         = "dist/final/lambda.zip"
  aws_api_proxy_name = "AwsApiProxy"
  security_group_id  = length(var.lambda_subnet_ids) > 0 ? aws_security_group.no_ingress_all_egress[0].id : ""
}

module "aws_api_proxy" {
  source = "../../tasks/aws-api-proxy/deploy"

  prefix                     = var.prefix
  lambda_processing_role_arn = var.lambda_processing_role_arn
  lambda_timeout             = lookup(var.lambda_timeouts, local.aws_api_proxy_name, 60 * 15)
  lambda_memory_size         = lookup(var.lambda_memory_sizes, local.aws_api_proxy_name, 4096)
  security_group_id          = local.security_group_id
  log_retention_days         = var.default_log_retention_days

  tags = var.tags
}
