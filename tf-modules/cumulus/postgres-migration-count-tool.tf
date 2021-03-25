module "postgres_migration_count_tool" {
  source = "../../lambdas/postgres-migration-count-tool"

  buckets                    = var.buckets
  prefix                     = var.prefix
  permissions_boundary_arn   = var.permissions_boundary_arn

  vpc_id                     = var.vpc_id
  lambda_subnet_ids          = var.lambda_subnet_ids

  dynamo_tables              = var.dynamo_tables
  rds_security_group_id      = var.rds_security_group
  rds_user_access_secret_arn = var.rds_user_access_secret_arn
  rds_connection_heartbeat   = var.rds_connection_heartbeat

  system_bucket              = var.system_bucket

  tags = var.tags
}

module "postgres_migration_count_tool_ecs_service" {
  source         = "../../tf-modules/cumulus_ecs_service"

  prefix         = var.prefix
  name           = "PostgresMigrationCountTool"

  cluster_arn    = aws_ecs_cluster.default.arn
  desired_count  = 1
  image          = "cumuluss/cumulus-ecs-task:1.7.0"

  command = [
    "cumulus-ecs-task",
    "--lambdaArn",
    module.postgres_migration_count_tool.postgres_migration_count_tool_function_arn
  ]
}