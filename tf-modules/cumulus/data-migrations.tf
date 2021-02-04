module "data_migration2" {
  source = "../../lambdas/data-migration2"

  prefix = var.prefix

  permissions_boundary_arn = var.permissions_boundary_arn

  vpc_id            = var.vpc_id
  lambda_subnet_ids = var.lambda_subnet_ids

  dynamo_tables = var.dynamo_tables

  rds_security_group_id = var.rds_security_group
  rds_user_access_secret_arn = var.database_credentials_secret_arn
  rds_connection_heartbeat = var.rds_connection_heartbeat

  tags = var.tags
}

module "data_migration2_ecs_service" {
  source = "../../tf-modules/cumulus_ecs_service"

  prefix = var.prefix
  name   = "DataMigration2Service"

  log2elasticsearch_lambda_function_arn = module.archive.log2elasticsearch_lambda_function_arn
  cluster_arn                           = aws_ecs_cluster.default.arn
  desired_count                         = 1
  image                                 = "cumuluss/cumulus-ecs-task:1.7.0"

  command = [
    "cumulus-ecs-task",
    "--lambdaArn",
    module.data_migration2.data_migration2_function_arn
  ]
}

