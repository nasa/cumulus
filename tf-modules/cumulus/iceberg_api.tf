module "iceberg_api" {
  count  = var.deploy_iceberg_api ? 1 : 0
  source = "../iceberg_api"

  prefix = var.prefix
  region = data.aws_region.current.name
  vpc_id = var.vpc_id
  tags   = var.tags

  permissions_boundary_arn = var.permissions_boundary_arn

  oauth_provider        = var.oauth_provider
  api_config_secret_arn = module.archive.api_config_secret_arn

  iceberg_api_cpu                   = var.iceberg_api_cpu
  iceberg_api_memory                = var.iceberg_api_memory
  cumulus_iceberg_api_image_version = var.cumulus_iceberg_api_image_version

  ecs_execution_role_arn          = aws_iam_role.ecs_execution_role.arn

  ecs_task_role_arn        = aws_iam_role.ecs_task_role.arn

  ecs_cluster_arn                 = aws_ecs_cluster.default.arn
  ecs_cluster_name                = aws_ecs_cluster.default.name
  ecs_cluster_instance_subnet_ids = var.ecs_cluster_instance_subnet_ids

  rds_security_group_id = var.rds_security_group

  iceberg_s3_bucket = var.iceberg_s3_bucket

  default_log_retention_days       = var.default_log_retention_days
  cloudwatch_log_retention_periods = var.cloudwatch_log_retention_periods

  api_service_autoscaling_min_capacity = var.api_service_autoscaling_min_capacity
  api_service_autoscaling_max_capacity = var.api_service_autoscaling_max_capacity
  api_service_autoscaling_target_cpu   = var.api_service_autoscaling_target_cpu
}
