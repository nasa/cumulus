module "postgres_migration_async_operation" {
  source = "../../lambdas/postgres-migration-async-operation"

  async_operation_task_definition_arn = module.archive.async_operation_task_definition_arn

  buckets                    = var.buckets

  data_migration2_function_arn = module.data_migration2.data_migration2_function_arn

  dynamo_tables              = var.dynamo_tables

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
  default_log_retention_days = var.default_log_retention_days
  cloudwatch_log_retention_periods = var.cloudwatch_log_retention_periods

}
