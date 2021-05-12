locals {
  api_id                    = var.deploy_to_ngap ? aws_api_gateway_rest_api.api[0].id : aws_api_gateway_rest_api.api_outside_ngap[0].id
  api_uri                   = var.api_url == null ? "https://${local.api_id}.execute-api.${data.aws_region.current.name}.amazonaws.com/${var.api_gateway_stage}/" : var.api_url
  api_redirect_uri          = "${local.api_uri}login"
  api_env_variables = {
      apiBaseUrl           = local.api_uri
      oauthClientId        = var.oauth_client_id
      oauthClientPasswordSecretName  = length(var.oauth_client_password) == 0 ? null : aws_secretsmanager_secret.api_oauth_client_password.name
      oauthHostUrl         = var.oauth_host_url
      oauthProvider        = var.oauth_provider
      stackName            = var.prefix
  }
  lambda_security_group_ids = [aws_security_group.no_ingress_all_egress[0].id]
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
  retention_in_days = 30
  tags              = var.tags
}

resource "aws_lambda_function" "api" {
  function_name    = "${var.prefix}-DistributionApiEndpoints"
  filename         = "${path.module}/../../packages/api/dist/distribution/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/distribution/lambda.zip")
  handler          = "index.handler"
  role             = aws_iam_role.lambda_distribution_api_gateway.arn
  runtime          = "nodejs12.x"
  timeout          = 100
  environment {
    variables = local.api_env_variables
  }
  memory_size = 960
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
  depends_on = [aws_api_gateway_integration.root_proxy, aws_api_gateway_integration.any_proxy]
  rest_api_id = var.deploy_to_ngap ? aws_api_gateway_rest_api.api[0].id : aws_api_gateway_rest_api.api_outside_ngap[0].id
  stage_name  = var.api_gateway_stage
}
