locals {
  api_port_substring = var.api_port == null ? "" : ":${var.api_port}"
}

resource "aws_lambda_function" "api" {
  depends_on = [aws_iam_role.lambda_api_gateway]

  function_name    = "${var.prefix}-ApiEndpoints"
  filename         = "${path.module}/../../packages/api/dist/app/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/app/lambda.zip")
  handler          = "index.handler"
  role             = aws_iam_role.lambda_api_gateway.arn
  runtime          = "nodejs8.10"
  timeout          = 20
  environment {
    variables = {
      AccessTokensTable            = var.dynamo_tables.AccessTokens
      AsyncOperationTaskDefinition = aws_ecs_task_definition.async_operation.arn
      AsyncOperationsTable         = var.dynamo_tables.AsyncOperations
      BulkDeleteLambda             = aws_lambda_function.bulk_delete.arn
      CMR_ENVIRONMENT              = var.cmr_environment
      CollectionsTable             = var.dynamo_tables.Collections
      EARTHDATA_BASE_URL           = "${replace(var.urs_url, "//$/", "")}/" # Make sure there's a trailing slash
      EARTHDATA_CLIENT_ID          = var.urs_client_id
      EARTHDATA_CLIENT_PASSWORD    = var.urs_client_password
      ES_HOST                      = var.elasticsearch_hostname
      EcsCluster                   = var.ecs_cluster_name
      EmsDistributionReport        = aws_lambda_function.ems_distribution_report.arn
      EmsIngestReport              = aws_lambda_function.ems_ingest_report.arn
      EmsProductMetadataReport     = aws_lambda_function.ems_product_metadata_report.arn
      ExecutionsTable              = var.dynamo_tables.Executions
      GranulesTable                = var.dynamo_tables.Granules
      IndexFromDatabaseLambda      = aws_lambda_function.index_from_database.arn
      KinesisInboundEventLogger    = aws_lambda_function.kinesis_inbound_event_logger.arn
      OAUTH_PROVIDER               = var.oauth_provider
      PdrsTable                    = var.dynamo_tables.Pdrs
      ProvidersTable               = var.dynamo_tables.Providers
      RulesTable                   = var.dynamo_tables.Rules
      STSCredentialsLambda         = var.sts_credentials_lambda
      TOKEN_REDIRECT_ENDPOINT      = var.api_url == null ? "https://${aws_api_gateway_rest_api.api.id}.execute-api.${data.aws_region.current.name}.amazonaws.com${local.api_port_substring}/${var.api_gateway_stage}/token" : "${var.api_url}token"
      TOKEN_SECRET                 = var.token_secret
      UsersTable                   = var.dynamo_tables.Users
      backgroundQueueName          = var.background_queue_name
      cmr_client_id                = var.cmr_client_id
      cmr_password                 = jsondecode(data.aws_lambda_invocation.custom_bootstrap.result).Data.CmrPassword
      cmr_provider                 = var.cmr_provider
      cmr_username                 = var.cmr_username
      distributionApiId            = var.distribution_api_id
      invoke                       = var.schedule_sf_function_arn
      invokeArn                    = var.schedule_sf_function_arn
      invokeReconcileLambda        = aws_lambda_function.create_reconciliation_report.arn
      messageConsumer              = var.message_consumer_function_arn
      stackName                    = var.prefix
      system_bucket                = var.system_bucket
      public_buckets               = join(",", var.public_buckets)
      protected_buckets            = join(",", var.protected_buckets)
    }
  }
  memory_size = 756
  tags = {
    Project = var.prefix
  }
  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = [aws_security_group.no_ingress_all_egress.id]
  }
}

resource "aws_api_gateway_rest_api" "api" {
  name = "${var.prefix}-archive"

  lifecycle {
    ignore_changes = [policy]
  }
}

resource "aws_api_gateway_resource" "proxy" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "any_proxy" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.proxy.id
  http_method   = "ANY"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "any_proxy" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.proxy.id
  http_method             = aws_api_gateway_method.any_proxy.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.api.invoke_arn
}

resource "aws_api_gateway_deployment" "api" {
  depends_on = ["aws_api_gateway_integration.any_proxy"]

  rest_api_id = aws_api_gateway_rest_api.api.id
  stage_name  = var.api_gateway_stage
}
