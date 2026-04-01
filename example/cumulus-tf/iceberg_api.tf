module "iceberg_api" {
  count = var.deploy_iceberg_api ? 1 : 0
  source = "../../tf-modules/iceberg_api"

  prefix             = var.prefix
  region             = var.region
  vpc_id             = var.vpc_id
  tags               = local.tags

  oauth_provider           = var.oauth_provider
  api_config_secret_arn    = module.cumulus.api_config_secret_arn
  iceberg_api_cpu          = var.iceberg_api_cpu
  iceberg_api_memory       = var.iceberg_api_memory
  cumulus_iceberg_api_image_version = var.cumulus_iceberg_api_image_version

  ecs_execution_role_arn   = module.cumulus.ecs_execution_role_arn
  ecs_task_role_arn        = module.cumulus.ecs_task_role_arn
  ecs_cluster_arn          = module.cumulus.ecs_cluster_arn
  ecs_cluster_name         = module.cumulus.ecs_cluster_name
  ecs_cluster_instance_subnet_ids = length(var.ecs_cluster_instance_subnet_ids) == 0 ? local.subnet_ids : var.ecs_cluster_instance_subnet_ids

  rds_security_group_id = local.rds_security_group

  api_service_autoscaling_min_capacity = var.api_service_autoscaling_min_capacity
  api_service_autoscaling_max_capacity = var.api_service_autoscaling_max_capacity
  api_service_autoscaling_target_cpu   = var.api_service_autoscaling_target_cpu
}
