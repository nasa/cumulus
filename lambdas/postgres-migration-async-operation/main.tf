locals {
  lambda_path      = "${path.module}/dist/webpack/lambda.zip"
}
resource "aws_lambda_function" "postgres-migration-async-operation" {
  function_name    = "${var.prefix}-postgres-migration-async-operation"
  role             = aws_iam_role.postgres_migration_async_operation_role.arn
  filename         = local.lambda_path
  source_code_hash = filebase64sha256(local.lambda_path)
  handler          = "index.handler"
  runtime          = "nodejs12.x"
  timeout          = 300
  memory_size      = 512

  environment {
    variables = {
      databaseCredentialSecretArn  = var.rds_user_access_secret_arn
      dbHeartBeat                  = var.rds_connection_heartbeat
      system_bucket                = var.system_bucket
      AsyncOperationsTable         = var.dynamo_tables.async_operations.name
      stackName                    = var.prefix
      MigrationLambda              = var.data_migration2_function_arn
      EcsCluster                   = var.ecs_cluster_name
      AsyncOperationTaskDefinition = var.async_operation_task_definition_arn
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = compact([
        aws_security_group.postgres_migration_async_operation[0].id,
        var.rds_security_group_id
      ])
    }
  }
}
