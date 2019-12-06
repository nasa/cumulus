terraform {
  required_providers {
    aws = ">= 2.31.0"
  }
}

locals {
  default_tags           = { Deployment = var.prefix }
  thin_egress_stack_name = "${var.prefix}-thin-egress-app"
  lambda_log_group_name  = "/aws/lambda/${local.thin_egress_stack_name}-EgressLambda"
}

resource "aws_s3_bucket_object" "bucket_map_yaml" {
  bucket  = var.system_bucket
  key     = "${var.prefix}/thin-egress-app/bucket_map.yaml"
  content = templatefile("${path.module}/bucket_map.yaml.tmpl", { protected_buckets = var.protected_buckets, public_buckets = var.public_buckets })
  etag    = md5(templatefile("${path.module}/bucket_map.yaml.tmpl", { protected_buckets = var.protected_buckets, public_buckets = var.public_buckets }))
  tags    = local.default_tags
}

resource "aws_secretsmanager_secret" "thin_egress_urs_creds" {
  name_prefix = "${var.prefix}-tea-urs-creds-"
  description = "URS credentials for the ${var.prefix} Thin Egress App"
  tags        = local.default_tags
}

resource "aws_secretsmanager_secret_version" "thin_egress_urs_creds" {
  secret_id     = aws_secretsmanager_secret.thin_egress_urs_creds.id
  secret_string = "{\"UrsId\": \"${var.urs_client_id}\",\"UrsAuth\": \"${base64encode("${var.urs_client_id}:${var.urs_client_password}")}\"}"
}

module "thin_egress_app" {
  source = "https://s3.amazonaws.com/asf.public.code/thin-egress-app/tea-terraform-build.36.zip"

  auth_base_url                 = var.urs_url
  bucket_map_file               = aws_s3_bucket_object.bucket_map_yaml.key
  bucketname_prefix             = ""
  config_bucket                 = var.system_bucket
  domain_name                   = var.distribution_url == null ? null : replace(replace(var.distribution_url, "/^https?:///", ""), "//$/", "")
  log_api_gateway_to_cloudwatch = var.log_api_gateway_to_cloudwatch
  permissions_boundary_name     = var.permissions_boundary_arn == null ? null : reverse(split("/", var.permissions_boundary_arn))[0]
  private_vpc                   = var.vpc_id
  stack_name                    = local.thin_egress_stack_name
  stage_name                    = var.api_gateway_stage
  vpc_subnet_ids                = var.subnet_ids
  urs_auth_creds_secret_name    = aws_secretsmanager_secret.thin_egress_urs_creds.name
}

data "aws_caller_identity" "current" {}

resource "aws_dynamodb_table" "access_tokens" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  name         = "${var.prefix}-s3-credentials-access-tokens"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "accessToken"

  attribute {
    name = "accessToken"
    type = "S"
  }

  tags = local.default_tags
}

data "aws_iam_policy_document" "assume_lambda_role" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  statement {
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "s3_credentials_lambda" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  name                 = "${var.prefix}-S3CredentialsLambda"
  assume_role_policy   = data.aws_iam_policy_document.assume_lambda_role[0].json
  permissions_boundary = var.permissions_boundary_arn
  # TODO Re-enable once IAM permissions have been fixed
  # tags                 = local.default_tags
}

data "aws_iam_policy_document" "s3_credentials_lambda" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [var.sts_credentials_lambda_function_arn]
  }

  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem"
    ]
    resources = [aws_dynamodb_table.access_tokens[0].arn]
  }

  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["arn:aws:logs:*:*:*"]
  }
  statement {
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "s3_credentials_lambda" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  policy = data.aws_iam_policy_document.s3_credentials_lambda[0].json
  role   = aws_iam_role.s3_credentials_lambda[0].id
}

resource "aws_security_group" "s3_credentials_lambda" {
  count = (var.deploy_s3_credentials_endpoint && var.vpc_id != null) ? 1 : 0

  vpc_id = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.default_tags
}

resource "aws_lambda_function" "s3_credentials" {
  count            = var.deploy_s3_credentials_endpoint ? 1 : 0

  function_name    = "${var.prefix}-s3-credentials-endpoint"
  filename         = "${path.module}/dist/src.zip"
  source_code_hash = filebase64sha256("${path.module}/dist/src.zip")
  handler          = "index.handler"
  role             = aws_iam_role.s3_credentials_lambda[0].arn
  runtime          = "nodejs8.10"
  timeout          = 10
  memory_size      = 320

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = (var.deploy_s3_credentials_endpoint && var.vpc_id != null) ? [aws_security_group.s3_credentials_lambda[0].id] : null
  }

  environment {
    variables = {
      DISTRIBUTION_ENDPOINT          = module.thin_egress_app.api_endpoint
      DISTRIBUTION_REDIRECT_ENDPOINT = "${module.thin_egress_app.api_endpoint}redirect"
      public_buckets                 = join(",", var.public_buckets)
      EARTHDATA_BASE_URL             = var.urs_url
      EARTHDATA_CLIENT_ID            = var.urs_client_id
      EARTHDATA_CLIENT_PASSWORD      = var.urs_client_password
      AccessTokensTable              = aws_dynamodb_table.access_tokens[0].id
      STSCredentialsLambda           = var.sts_credentials_lambda_function_arn
    }
  }
  tags = local.default_tags
}

data "aws_region" "current" {}

resource "aws_lambda_permission" "lambda_permission" {
  count            = var.deploy_s3_credentials_endpoint ? 1 : 0

  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.s3_credentials[0].function_name
  principal     = "apigateway.amazonaws.com"

  # The /*/*/* part allows invocation from any stage, method and resource path
  # within API Gateway REST API.
  source_arn = "arn:aws:execute-api:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:${module.thin_egress_app.rest_api.id}/*/*/*"
}

# GET /s3credentials
resource "aws_api_gateway_resource" "s3_credentials" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  rest_api_id = module.thin_egress_app.rest_api.id
  parent_id   = module.thin_egress_app.rest_api.root_resource_id
  path_part   = "s3credentials"
}

resource "aws_api_gateway_method" "s3_credentials" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  rest_api_id   = module.thin_egress_app.rest_api.id
  resource_id   = aws_api_gateway_resource.s3_credentials[0].id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "s3_credentials" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  rest_api_id             = module.thin_egress_app.rest_api.id
  resource_id             = aws_api_gateway_resource.s3_credentials[0].id
  http_method             = aws_api_gateway_method.s3_credentials[0].http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.s3_credentials[0].invoke_arn
}

# GET /redirect
resource "aws_api_gateway_resource" "s3_credentials_redirect" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  rest_api_id = module.thin_egress_app.rest_api.id
  parent_id   = module.thin_egress_app.rest_api.root_resource_id
  path_part   = "redirect"
}

resource "aws_api_gateway_method" "s3_credentials_redirect" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  rest_api_id   = module.thin_egress_app.rest_api.id
  resource_id   = aws_api_gateway_resource.s3_credentials_redirect[0].id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "s3_credentials_redirect" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  rest_api_id             = module.thin_egress_app.rest_api.id
  resource_id             = aws_api_gateway_resource.s3_credentials_redirect[0].id
  http_method             = aws_api_gateway_method.s3_credentials_redirect[0].http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.s3_credentials[0].invoke_arn
}

# API deployment
resource "aws_api_gateway_deployment" "s3_credentials" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  depends_on = [
    aws_api_gateway_integration.s3_credentials_redirect[0],
    aws_api_gateway_integration.s3_credentials[0]
  ]

  rest_api_id = module.thin_egress_app.rest_api.id
  stage_name  = var.api_gateway_stage
}

# Egress Api Gateway Log Group Filter
resource "aws_cloudwatch_log_subscription_filter" "egress_api_gateway_log_subscription_filter" {
  count           = var.log_destination_arn != null && var.log_api_gateway_to_cloudwatch ? 1 : 0
  name            = "${var.prefix}-EgressApiGatewayCloudWatchLogSubscriptionToSharedDestination"
  distribution    = "ByLogStream"
  destination_arn = var.log_destination_arn
  filter_pattern  = ""
  log_group_name  = module.thin_egress_app.egress_log_group
}

# Egress Lambda Log Group
resource "aws_cloudwatch_log_group" "egress_lambda_log_group" {
  count             = var.log_destination_arn == null ? 0 : 1
  name              = local.lambda_log_group_name
  retention_in_days = 30
  tags              = local.default_tags
}

# Egress Lambda Log Group Filter
resource "aws_cloudwatch_log_subscription_filter" "egress_lambda_log_subscription_filter" {
  depends_on      = [aws_cloudwatch_log_group.egress_lambda_log_group]
  count           = var.log_destination_arn == null ? 0 : 1
  name            = "${var.prefix}-EgressLambdaLogSubscriptionToSharedDestination"
  destination_arn = var.log_destination_arn
  distribution    = "ByLogStream"
  filter_pattern  = ""
  log_group_name  = local.lambda_log_group_name
}
