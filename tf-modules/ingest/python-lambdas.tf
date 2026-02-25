locals {
    task_root = "${path.module}/../../tasks"
    zip_subdir = "dist/final/lambda.zip"
    aws_api_proxy_name = "aws-api-proxy"
    security_group_id = length(var.lambda_subnet_ids) > 0 ? aws_security_group.no_ingress_all_egress[0].id : ""
}

module "aws_api_proxy" {
    source = "../cumulus-task"
    prefix = var.prefix
    role = var.lambda_processing_role_arn
    lambda_zip_path = abspath("${local.task_root}/${local.aws_api_proxy_name}/${local.zip_subdir}")
    name = local.aws_api_proxy_name
    subnet_ids = var.lambda_subnet_ids
    security_group_id = local.security_group_id
    timeout = lookup(var.lambda_timeouts, local.aws_api_proxy_name, 60 * 15)
    memory_size = lookup(var.lambda_memory_sizes, local.aws_api_proxy_name, 4096)
    default_log_retention_days = var.default_log_retention_days
    tags = var.tags
}
