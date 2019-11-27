resource "aws_lambda_function" "bulk_operation" {
  function_name    = "${var.prefix}-bulkOperation"
  filename         = "${path.module}/../../packages/api/dist/bulkOperation/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/bulkOperation/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
  timeout          = 300
  memory_size      = 512
  environment {
    variables = {
      METRICS_ES_HOST  = var.metrics_es_host
      METRICS_ES_USER  = var.metrics_es_username
      METRICS_ES_PASS  = var.metrics_es_password
      GranulesTable    = var.dynamo_tables.granules.name
      system_bucket    = var.system_bucket
      invoke           = var.schedule_sf_function_arn
      stackName        = var.prefix
    }
  }
  tags = merge(local.default_tags, { Project = var.prefix })

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }
}
