locals {
  api_id                    = var.deploy_to_ngap ? aws_api_gateway_rest_api.api[0].id : aws_api_gateway_rest_api.api_outside_ngap[0].id
  api_uri                   = var.api_url == null ? "https://${local.api_id}.execute-api.${data.aws_region.current.name}.amazonaws.com/${var.api_gateway_stage}/" : var.api_url
  api_redirect_uri          = "${local.api_uri}login"
  api_env_variables = {
      AccessTokensTable              = aws_dynamodb_table.access_tokens.id
      BUCKETNAME_PREFIX              = var.bucketname_prefix
      BUCKET_MAP_FILE                = var.bucket_map_file
      CMR_ACL_BASED_CREDENTIALS      = var.cmr_acl_based_credentials
      CMR_ENVIRONMENT                = var.cmr_environment
      DISTRIBUTION_ENDPOINT          = local.api_uri
      DISTRIBUTION_REDIRECT_ENDPOINT = local.api_redirect_uri
      OAUTH_CLIENT_ID                = var.oauth_client_id
      OAUTH_CLIENT_PASSWORD_SECRET_NAME = length(var.oauth_client_password) == 0 ? null : aws_secretsmanager_secret.api_oauth_client_password.name
      OAUTH_HOST_URL                 = var.oauth_host_url
      OAUTH_PROVIDER                 = var.oauth_provider
      STS_CREDENTIALS_LAMBDA         = var.sts_credentials_lambda_function_arn
      STS_POLICY_HELPER_LAMBDA       = var.sts_policy_helper_lambda_function_arn
      cmr_provider                   = var.cmr_provider
      stackName                      = var.prefix
      system_bucket                  = var.system_bucket
  }
}

resource "aws_secretsmanager_secret" "api_oauth_client_password" {
  name_prefix = "${var.prefix}-distribution-api-oauth-client-password"
  description = "OAuth client password for the Cumulus Distribution API's ${var.prefix} deployment"
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "api_oauth_client_password" {
  count         = length(var.oauth_client_password) == 0 ? 0 : 1
  secret_id     = aws_secretsmanager_secret.api_oauth_client_password.id
  secret_string = var.oauth_client_password
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${aws_lambda_function.api.function_name}"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "DistributionApiEndpoints", var.default_log_retention_days)
  tags              = var.tags
}

resource "aws_lambda_function" "api" {
  function_name    = "${var.prefix}-DistributionApiEndpoints"
  filename         = "${path.module}/../../packages/api/dist/distribution/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/distribution/lambda.zip")
  handler          = "index.handler"
  role             = aws_iam_role.lambda_distribution_api_gateway.arn
  runtime          = "nodejs22.x"
  timeout          = lookup(var.lambda_timeouts, "DistributionApiEndpoints", 100)
  environment {
    variables = local.api_env_variables
  }
  memory_size = lookup(var.lambda_memory_sizes, "DistributionApiEndpoints", 960)
  tags        = var.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = local.lambda_security_group_ids
    }
  }
}

data "aws_iam_policy_document" "private_api_policy_document" {
  count = var.deploy_to_ngap ? 1 : 0
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
  count = var.deploy_to_ngap ? 1 : 0
  name = "${var.prefix}-distribution"

  lifecycle {
    ignore_changes = [policy]
  }

  policy = data.aws_iam_policy_document.private_api_policy_document[0].json

  endpoint_configuration {
    types = ["PRIVATE"]
  }

  tags = var.tags
}

resource "aws_api_gateway_rest_api" "api_outside_ngap" {
  count = var.deploy_to_ngap ? 0 : 1
  name = "${var.prefix}-distribution"

  policy = data.aws_iam_policy_document.private_api_policy_document[0].json

  endpoint_configuration {
    types = ["PRIVATE"]
  }
}

resource "aws_lambda_permission" "api_endpoints_lambda_permission" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.arn
  principal     = "apigateway.amazonaws.com"
}

resource "aws_api_gateway_resource" "proxy" {
  rest_api_id = var.deploy_to_ngap ? aws_api_gateway_rest_api.api[0].id: aws_api_gateway_rest_api.api_outside_ngap[0].id
  parent_id   = var.deploy_to_ngap ? aws_api_gateway_rest_api.api[0].root_resource_id : aws_api_gateway_rest_api.api_outside_ngap[0].root_resource_id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "any_proxy" {
  rest_api_id   = var.deploy_to_ngap ? aws_api_gateway_rest_api.api[0].id : aws_api_gateway_rest_api.api_outside_ngap[0].id
  resource_id   = aws_api_gateway_resource.proxy.id
  http_method   = "ANY"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "any_proxy" {
  rest_api_id             = var.deploy_to_ngap ? aws_api_gateway_rest_api.api[0].id : aws_api_gateway_rest_api.api_outside_ngap[0].id
  resource_id             = aws_api_gateway_resource.proxy.id
  http_method             = aws_api_gateway_method.any_proxy.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.api.invoke_arn
}

resource "aws_api_gateway_method" "root_proxy" {
  rest_api_id   = var.deploy_to_ngap ? aws_api_gateway_rest_api.api[0].id : aws_api_gateway_rest_api.api_outside_ngap[0].id
  resource_id   = var.deploy_to_ngap ? aws_api_gateway_rest_api.api[0].root_resource_id : aws_api_gateway_rest_api.api_outside_ngap[0].root_resource_id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "root_proxy" {
  rest_api_id             = var.deploy_to_ngap ? aws_api_gateway_rest_api.api[0].id : aws_api_gateway_rest_api.api_outside_ngap[0].id
  resource_id             = var.deploy_to_ngap ? aws_api_gateway_rest_api.api[0].root_resource_id : aws_api_gateway_rest_api.api_outside_ngap[0].root_resource_id
  http_method             = aws_api_gateway_method.root_proxy.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.api.invoke_arn
}

resource "aws_api_gateway_deployment" "api" {
  depends_on        = [aws_api_gateway_integration.root_proxy, aws_api_gateway_integration.any_proxy]
  rest_api_id       = var.deploy_to_ngap ? aws_api_gateway_rest_api.api[0].id : aws_api_gateway_rest_api.api_outside_ngap[0].id
  stage_description = md5(file("${path.module}/api.tf"))
  stage_name        = var.api_gateway_stage
}

# this overrides the distribution (TEA) module generated bucket map cache if any
data "aws_lambda_invocation" "bucket_map_cache" {
  function_name         = aws_lambda_function.api.function_name
  input                 = jsonencode({
    eventType           = "createBucketMapCache"
    bucketList          = local.distribution_buckets,
    s3Bucket            = var.system_bucket
    s3Key               = local.distribution_bucket_map_key
    replacementTrigger  = timestamp()
  })
}
