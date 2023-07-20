terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 3.0,!= 3.14.0"
    }
  }
}

locals {
  tea_buckets        = concat(var.protected_buckets, var.public_buckets)
  lambda_source_file = "${path.module}/../../packages/s3-credentials-endpoint/dist/lambda.zip"
}

module "tea_map_cache" {
  prefix                     = var.prefix
  source                     = "../tea-map-cache"
  lambda_processing_role_arn = var.lambda_processing_role_arn
  tea_api_url                = var.tea_internal_api_endpoint
  tags                       = var.tags
  lambda_subnet_ids          = var.subnet_ids
  vpc_id                     = var.vpc_id
  deploy_to_ngap             = var.deploy_to_ngap
  default_log_retention_days = var.default_log_retention_days
  cloudwatch_log_retention_periods = var.cloudwatch_log_retention_periods
}

data "aws_lambda_invocation" "tea_map_cache" {
  function_name         = module.tea_map_cache.lambda_function_name
  input                 = jsonencode({
    bucketList          = local.tea_buckets,
    s3Bucket            = var.system_bucket
    s3Key               = "${var.prefix}/distribution_bucket_map.json"
    replacementTrigger  = timestamp()
  })
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

  tags = var.tags
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
  tags                 = var.tags
}

data "aws_iam_policy_document" "s3_credentials_lambda" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [var.sts_credentials_lambda_function_arn, var.sts_policy_helper_lambda_function_arn]
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
  count  = var.deploy_s3_credentials_endpoint ? 1 : 0
  name   = "${var.prefix}_s3_credentials_lambda_policy"
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
  tags = var.tags
}

resource "aws_lambda_function" "s3_credentials" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  function_name    = "${var.prefix}-s3-credentials-endpoint"
  filename         = local.lambda_source_file
  source_code_hash = filebase64sha256(local.lambda_source_file)
  handler          = "index.handler"
  role             = aws_iam_role.s3_credentials_lambda[0].arn
  runtime          = "nodejs16.x"
  timeout          = 50
  memory_size      = 512

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = (var.deploy_s3_credentials_endpoint && var.vpc_id != null) ? [aws_security_group.s3_credentials_lambda[0].id] : null
  }

  environment {
    variables = {
      AccessTokensTable              = aws_dynamodb_table.access_tokens[0].id
      CMR_ACL_BASED_CREDENTIALS      = var.cmr_acl_based_credentials
      CMR_ENVIRONMENT                = var.cmr_environment
      DISTRIBUTION_ENDPOINT          = var.tea_external_api_endpoint
      DISTRIBUTION_REDIRECT_ENDPOINT = "${var.tea_external_api_endpoint}redirect"
      OAUTH_CLIENT_ID                = var.urs_client_id
      OAUTH_CLIENT_PASSWORD          = var.urs_client_password
      OAUTH_HOST_URL                 = var.urs_url
      OAUTH_PROVIDER                 = "earthdata"
      STS_CREDENTIALS_LAMBDA         = var.sts_credentials_lambda_function_arn
      STS_POLICY_HELPER_LAMBDA       = var.sts_policy_helper_lambda_function_arn
      cmr_provider                   = var.cmr_provider
      public_buckets                 = join(",", var.public_buckets)
    }
  }
  tags = var.tags
}

data "aws_region" "current" {}

resource "aws_lambda_permission" "lambda_permission" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.s3_credentials[0].function_name
  principal     = "apigateway.amazonaws.com"

  # The /*/*/* part allows invocation from any stage, method and resource path
  # within API Gateway REST API.
  source_arn = "arn:aws:execute-api:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:${var.tea_rest_api_id}/*/*/*"
}

# GET /s3credentials
resource "aws_api_gateway_resource" "s3_credentials" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  rest_api_id = var.tea_rest_api_id
  parent_id   = var.tea_rest_api_root_resource_id
  path_part   = "s3credentials"
}

resource "aws_api_gateway_method" "s3_credentials" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  rest_api_id   = var.tea_rest_api_id
  resource_id   = aws_api_gateway_resource.s3_credentials[0].id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "s3_credentials" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  rest_api_id             = var.tea_rest_api_id
  resource_id             = aws_api_gateway_resource.s3_credentials[0].id
  http_method             = aws_api_gateway_method.s3_credentials[0].http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.s3_credentials[0].invoke_arn
}

# GET /redirect
resource "aws_api_gateway_resource" "s3_credentials_redirect" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  rest_api_id = var.tea_rest_api_id
  parent_id   = var.tea_rest_api_root_resource_id
  path_part   = "redirect"
}

resource "aws_api_gateway_method" "s3_credentials_redirect" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  rest_api_id   = var.tea_rest_api_id
  resource_id   = aws_api_gateway_resource.s3_credentials_redirect[0].id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "s3_credentials_redirect" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  rest_api_id             = var.tea_rest_api_id
  resource_id             = aws_api_gateway_resource.s3_credentials_redirect[0].id
  http_method             = aws_api_gateway_method.s3_credentials_redirect[0].http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.s3_credentials[0].invoke_arn
}

# GET /s3credentialsREADME
resource "aws_api_gateway_resource" "s3_credentials_readme" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  rest_api_id = var.tea_rest_api_id
  parent_id   = var.tea_rest_api_root_resource_id
  path_part   = "s3credentialsREADME"
}

resource "aws_api_gateway_method" "s3_credentials_readme" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  rest_api_id   = var.tea_rest_api_id
  resource_id   = aws_api_gateway_resource.s3_credentials_readme[0].id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "s3_credentials_readme" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  rest_api_id             = var.tea_rest_api_id
  resource_id             = aws_api_gateway_resource.s3_credentials_readme[0].id
  http_method             = aws_api_gateway_method.s3_credentials_readme[0].http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.s3_credentials[0].invoke_arn
}


# API deployment
resource "aws_api_gateway_deployment" "s3_credentials" {
  count = var.deploy_s3_credentials_endpoint ? 1 : 0

  depends_on = [
    aws_api_gateway_integration.s3_credentials_redirect[0],
    aws_api_gateway_integration.s3_credentials[0],
    aws_api_gateway_integration.s3_credentials_readme[0]
  ]

  triggers = {
    redeployment = sha1(join(",", tolist([
      jsonencode( aws_api_gateway_integration.s3_credentials_redirect[0] ),
      jsonencode( aws_api_gateway_integration.s3_credentials[0] ),
      jsonencode( aws_api_gateway_integration.s3_credentials_readme[0] ),
      ])))
  }


  rest_api_id = var.tea_rest_api_id
  stage_name  = var.tea_api_gateway_stage

}
