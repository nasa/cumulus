module "postgres_migration_async_operation" {
  source = "../../lambdas/postgres-migration-async-operation"

  async_operation_task_definition_arn = module.archive.async_operation_task_definition_arn

  buckets                    = var.buckets

  data_migration2_function_arn = module.data_migration2.data_migration2_function_arn

  dynamo_tables              = var.dynamo_tables

  ecs_cluster_name      = aws_ecs_cluster.default.name

  lambda_subnet_ids          = var.lambda_subnet_ids

  prefix                     = var.prefix
  permissions_boundary_arn   = var.permissions_boundary_arn

  rds_connection_heartbeat   = var.rds_connection_heartbeat
  rds_security_group_id      = var.rds_security_group
  rds_user_access_secret_arn = var.rds_user_access_secret_arn

  system_bucket              = var.system_bucket

  tags                       = var.tags

  vpc_id                     = var.vpc_id
}
