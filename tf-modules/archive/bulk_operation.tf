resource "aws_lambda_function" "bulk_operation" {
  depends_on       = [aws_cloudwatch_log_group.bulk_operation]
  function_name    = "${var.prefix}-bulkOperation"
  filename         = "${path.module}/../../packages/api/dist/bulkOperation/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/bulkOperation/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs16.x"
  timeout          = 300
  memory_size      = 512
  environment {
    variables = {
      acquireTimeoutMillis         = var.rds_connection_timing_configuration.acquireTimeoutMillis
      createRetryIntervalMillis    = var.rds_connection_timing_configuration.createRetryIntervalMillis
      createTimeoutMillis          = var.rds_connection_timing_configuration.createTimeoutMillis
      ES_HOST                      = var.elasticsearch_hostname
      granule_sns_topic_arn        = aws_sns_topic.report_granules_topic.arn
      GranulesTable                = var.dynamo_tables.granules.name
      idleTimeoutMillis            = var.rds_connection_timing_configuration.idleTimeoutMillis
      invoke                       = var.schedule_sf_function_arn
      METRICS_ES_HOST              = var.metrics_es_host
      METRICS_ES_PASS              = var.metrics_es_password
      METRICS_ES_USER              = var.metrics_es_username
      reapIntervalMillis           = var.rds_connection_timing_configuration.reapIntervalMillis
      stackName                    = var.prefix
      system_bucket                = var.system_bucket
    }
  }

  tags = var.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [
        aws_security_group.no_ingress_all_egress[0].id
      ]
    }
  }
}

resource "aws_cloudwatch_log_group" "bulk_operation" {
  name = "/aws/lambda/${var.prefix}-bulkOperation"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "bulkOperation", var.default_log_retention_days)
  tags = var.tags
}
