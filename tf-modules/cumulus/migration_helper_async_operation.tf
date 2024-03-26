module "migration_helper_async_operation" {
  source = "../../lambdas/migration-helper-async-operation"

  async_operation_task_definition_arn = module.archive.async_operation_task_definition_arn

  buckets                    = var.buckets

  dla_migration_function_arn = module.dla_migration_lambda.lambda_arn

  ecs_cluster_name      = aws_ecs_cluster.default.name

  ecs_execution_role_arn = aws_iam_role.ecs_execution_role.arn
  ecs_task_role_arn = aws_iam_role.ecs_task_role.arn

  elasticsearch_hostname              = var.elasticsearch_hostname
  elasticsearch_security_group_id     = var.elasticsearch_security_group_id

  lambda_subnet_ids          = var.lambda_subnet_ids

  prefix                     = var.prefix
  permissions_boundary_arn   = var.permissions_boundary_arn

  rds_connection_timing_configuration    = var.rds_connection_timing_configuration
  rds_security_group_id                  = var.rds_security_group
  rds_user_access_secret_arn             = var.rds_user_access_secret_arn

  system_bucket              = var.system_bucket
  tags                       = var.tags
  vpc_id                     = var.vpc_id
}

