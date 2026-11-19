# ExportTable - streams large (e.g. >500K row) table search results to a
# gzipped CSV in S3 as a background async operation.

resource "aws_lambda_function" "export_table" {
  function_name    = "${var.prefix}-exportTable"
  filename         = "${path.module}/../../packages/api/dist/exportTable/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/exportTable/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs22.x"
  timeout          = lookup(var.lambda_timeouts, "exportTable", 900)
  memory_size      = lookup(var.lambda_memory_sizes, "exportTable", 512)
  environment {
    variables = {
      acquireTimeoutMillis        = var.rds_connection_timing_configuration.acquireTimeoutMillis
      createRetryIntervalMillis   = var.rds_connection_timing_configuration.createRetryIntervalMillis
      createTimeoutMillis         = var.rds_connection_timing_configuration.createTimeoutMillis
      databaseCredentialSecretArn = var.rds_user_access_secret_arn
      idleTimeoutMillis           = var.rds_connection_timing_configuration.idleTimeoutMillis
      reapIntervalMillis          = var.rds_connection_timing_configuration.reapIntervalMillis
      stackName                   = var.prefix
      system_bucket               = var.system_bucket
    }
  }

  tags = var.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids         = var.lambda_subnet_ids
      security_group_ids = concat(local.lambda_security_group_ids, [var.rds_security_group])
    }
  }
}
