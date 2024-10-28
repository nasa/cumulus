locals {
  lambda_path      = "${path.module}/dist/webpack/lambda.zip"
}
resource "aws_lambda_function" "migration_helper_async_operation" {
  function_name    = "${var.prefix}-migrationHelperAsyncOperation"
  role             = aws_iam_role.migration_helper_async_operation_role.arn
  filename         = local.lambda_path
  source_code_hash = filebase64sha256(local.lambda_path)
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = lookup(var.lambda_timeouts, "migrationHelperAsyncOperation", 300)
  memory_size      = lookup(var.lambda_memory_sizes, "migrationHelperAsyncOperation", 512)

  environment {
    variables = {
      acquireTimeoutMillis         = var.rds_connection_timing_configuration.acquireTimeoutMillis
      AsyncOperationTaskDefinition = var.async_operation_task_definition_arn
      createRetryIntervalMillis    = var.rds_connection_timing_configuration.createRetryIntervalMillis
      createTimeoutMillis          = var.rds_connection_timing_configuration.createTimeoutMillis
      databaseCredentialSecretArn  = var.rds_user_access_secret_arn
      EcsCluster                   = var.ecs_cluster_name
      ES_HOST                      = var.elasticsearch_hostname
      idleTimeoutMillis            = var.rds_connection_timing_configuration.idleTimeoutMillis
      DlaMigrationLambda           = var.dla_migration_function_arn
      reapIntervalMillis           = var.rds_connection_timing_configuration.reapIntervalMillis
      stackName                    = var.prefix
      system_bucket                = var.system_bucket
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = compact([
        aws_security_group.migration_helper_async_operation[0].id,
        var.rds_security_group_id,
        var.elasticsearch_security_group_id
      ])
    }
  }
}
