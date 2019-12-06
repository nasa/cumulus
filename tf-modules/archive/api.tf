locals {
  api_port_substring = var.api_port == null ? "" : ":${var.api_port}"
  api_uri            = var.api_url == null ? "https://${aws_api_gateway_rest_api.api.id}.execute-api.${data.aws_region.current.name}.amazonaws.com${local.api_port_substring}/${var.api_gateway_stage}/" : var.api_url
  api_redirect_uri   = "${local.api_uri}token"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${aws_lambda_function.api.function_name}"
  retention_in_days = 30
  tags              = local.default_tags
}

resource "aws_lambda_function" "api" {
  function_name    = "${var.prefix}-ApiEndpoints"
  filename         = "${path.module}/../../packages/api/dist/app/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/app/lambda.zip")
  handler          = "index.handler"
  role             = aws_iam_role.lambda_api_gateway.arn
  runtime          = "nodejs8.10"
  timeout          = 100
  environment {
    variables = {
      AccessTokensTable            = var.dynamo_tables.access_tokens.name
      AsyncOperationTaskDefinition = aws_ecs_task_definition.async_operation.arn
      AsyncOperationsTable         = var.dynamo_tables.async_operations.name
      BulkDeleteLambda             = aws_lambda_function.bulk_delete.arn
      BulkOperationLambda          = aws_lambda_function.bulk_operation.arn
      CMR_ENVIRONMENT              = var.cmr_environment
      CollectionsTable             = var.dynamo_tables.collections.name
      EARTHDATA_BASE_URL           = "${replace(var.urs_url, "//*$/", "/")}" # Makes sure there's one and only one trailing slash
      EARTHDATA_CLIENT_ID          = var.urs_client_id
      EARTHDATA_CLIENT_PASSWORD    = var.urs_client_password
      ES_HOST                      = var.elasticsearch_hostname
      EcsCluster                   = var.ecs_cluster_name
      EmsDistributionReport        = aws_lambda_function.ems_distribution_report.arn
      EmsIngestReport              = aws_lambda_function.ems_ingest_report.arn
      EmsProductMetadataReport     = aws_lambda_function.ems_product_metadata_report.arn
      ExecutionsTable              = var.dynamo_tables.executions.name
      GranulesTable                = var.dynamo_tables.granules.name
      IndexFromDatabaseLambda      = aws_lambda_function.index_from_database.arn
      KinesisInboundEventLogger    = var.kinesis_inbound_event_logger_lambda_function_arn
      OAUTH_PROVIDER               = var.oauth_provider
      PdrsTable                    = var.dynamo_tables.pdrs.name
      ProvidersTable               = var.dynamo_tables.providers.name
      RulesTable                   = var.dynamo_tables.rules.name
      oauth_user_group             = var.oauth_user_group
      TOKEN_REDIRECT_ENDPOINT      = local.api_redirect_uri
      TOKEN_SECRET                 = var.token_secret
      UsersTable                   = var.dynamo_tables.users.name
      backgroundQueueName          = var.background_queue_name
      cmr_client_id                = var.cmr_client_id
      cmr_oauth_provider           = var.cmr_oauth_provider
      cmr_password                 = jsondecode(data.aws_lambda_invocation.custom_bootstrap.result).Data.CmrPassword
      cmr_provider                 = var.cmr_provider
      cmr_username                 = var.cmr_username
      distributionApiId            = var.distribution_api_id
      invoke                       = var.schedule_sf_function_arn
      invokeArn                    = var.schedule_sf_function_arn
      invokeReconcileLambda        = aws_lambda_function.create_reconciliation_report.arn
      launchpad_api                = var.launchpad_api
      launchpad_certificate        = var.launchpad_certificate
      launchpad_passphrase         = jsondecode(data.aws_lambda_invocation.custom_bootstrap.result).Data.LaunchpadPassphrase
      messageConsumer              = var.message_consumer_function_arn
      stackName                    = var.prefix
      system_bucket                = var.system_bucket
      public_buckets               = join(",", var.public_buckets)
      protected_buckets            = join(",", var.protected_buckets)
      ENTITY_ID                    = var.saml_entity_id
      ASSERT_ENDPOINT              = var.saml_assertion_consumer_service
      IDP_LOGIN                    = var.saml_idp_login
      LAUNCHPAD_METADATA_PATH      = var.saml_launchpad_metadata_path
      METRICS_ES_HOST              = var.metrics_es_host
      METRICS_ES_USER              = var.metrics_es_username
      METRICS_ES_PASS              = var.metrics_es_password
    }
  }
  memory_size = 756
  tags        = merge(local.default_tags, { Project = var.prefix })

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id, var.elasticsearch_security_group_id]
  }
}

data "aws_iam_policy_document" "private_api_policy_document" {
  statement {
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    actions = [ "*" ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceVpc"
      values = [var.vpc_id]
    }
  }
}

resource "aws_api_gateway_rest_api" "api" {
  name = "${var.prefix}-archive"

  lifecycle {
    ignore_changes = [policy]
  }

  policy = var.private_archive_api_gateway ? data.aws_iam_policy_document.private_api_policy_document.json : null

  endpoint_configuration {
    types = var.private_archive_api_gateway ? ["PRIVATE"] : ["EDGE"]
  }
}

resource "aws_lambda_permission" "api_endpoints_lambda_permission" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.arn
  principal     = "apigateway.amazonaws.com"
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
