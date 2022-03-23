resource "aws_lambda_function" "bulk_operation" {
  function_name    = "${var.prefix}-bulkOperation"
  filename         = "${path.module}/../../packages/api/dist/bulkOperation/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/bulkOperation/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs12.x"
  timeout          = 300
  memory_size      = 512
  environment {
    variables = {
      METRICS_ES_HOST        = var.metrics_es_host
      METRICS_ES_USER        = var.metrics_es_username
      METRICS_ES_PASS        = var.metrics_es_password
      ES_HOST                = var.elasticsearch_hostname
      GranulesTable          = var.dynamo_tables.granules.name
      granule_sns_topic_arn  = aws_sns_topic.report_granules_topic.arn
      system_bucket          = var.system_bucket
      invoke                 = var.schedule_sf_function_arn
      stackName              = var.prefix
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
