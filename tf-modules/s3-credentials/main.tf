terraform {
  required_providers {
    aws = ">= 2.31.0"
  }
}

locals {
  lambda_source_file = "${path.module}/../../packages/s3-credentials-endpoint/dist/lambda.zip"
}

data "aws_caller_identity" "current" {}

resource "aws_dynamodb_table" "access_tokens" {
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
  statement {
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "s3_credentials_lambda" {
  name                 = "${var.prefix}-S3CredentialsLambda"
  assume_role_policy   = data.aws_iam_policy_document.assume_lambda_role.json
  permissions_boundary = var.permissions_boundary_arn
  tags                 = var.tags
}

data "aws_iam_policy_document" "s3_credentials_lambda" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [var.sts_credentials_lambda_function_arn]
  }

  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem"
    ]
    resources = [aws_dynamodb_table.access_tokens.arn]
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
  name   = "${var.prefix}_s3_credentials_lambda_policy"
  policy = data.aws_iam_policy_document.s3_credentials_lambda.json
  role   = aws_iam_role.s3_credentials_lambda.id
}

resource "aws_security_group" "s3_credentials_lambda" {
  count = (var.vpc_id != null) ? 1 : 0

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
  function_name    = "${var.prefix}-s3-credentials-endpoint"
  filename         = local.lambda_source_file
  source_code_hash = filebase64sha256(local.lambda_source_file)
  handler          = "index.handler"
  role             = aws_iam_role.s3_credentials_lambda.arn
  runtime          = "nodejs12.x"
  timeout          = 10
  memory_size      = 320

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = (var.vpc_id != null) ? [aws_security_group.s3_credentials_lambda[0].id] : null
  }

  environment {
    variables = {
      DISTRIBUTION_ENDPOINT          = var.external_api_endpoint
      DISTRIBUTION_REDIRECT_ENDPOINT = "${var.external_api_endpoint}redirect"
      public_buckets                 = join(",", var.public_buckets)
      EARTHDATA_BASE_URL             = var.urs_url
      EARTHDATA_CLIENT_ID            = var.urs_client_id
      EARTHDATA_CLIENT_PASSWORD      = var.urs_client_password
      AccessTokensTable              = aws_dynamodb_table.access_tokens.id
      STSCredentialsLambda           = var.sts_credentials_lambda_function_arn
    }
  }
  tags = var.tags
}

data "aws_region" "current" {}

resource "aws_lambda_permission" "lambda_permission" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.s3_credentials.function_name
  principal     = "apigateway.amazonaws.com"

  # The /*/*/* part allows invocation from any stage, method and resource path
  # within API Gateway REST API.
  source_arn = "arn:aws:execute-api:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:${var.rest_api_id}/*/*/*"
}

# GET /s3credentials
resource "aws_api_gateway_resource" "s3_credentials" {
  rest_api_id = var.rest_api_id
  parent_id = var.rest_api_root_resource_id
  path_part   = "s3credentials"
}

resource "aws_api_gateway_method" "s3_credentials" {
  rest_api_id   = var.rest_api_id
  resource_id   = aws_api_gateway_resource.s3_credentials.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "s3_credentials" {
  rest_api_id             = var.rest_api_id
  resource_id             = aws_api_gateway_resource.s3_credentials.id
  http_method             = aws_api_gateway_method.s3_credentials.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.s3_credentials.invoke_arn
}

# GET /redirect
resource "aws_api_gateway_resource" "s3_credentials_redirect" {
  rest_api_id = var.rest_api_id
  parent_id   = var.rest_api_root_resource_id
  path_part   = "redirect"
}

resource "aws_api_gateway_method" "s3_credentials_redirect" {
  rest_api_id   = var.rest_api_id
  resource_id   = aws_api_gateway_resource.s3_credentials_redirect.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "s3_credentials_redirect" {
  rest_api_id             = var.rest_api_id
  resource_id             = aws_api_gateway_resource.s3_credentials_redirect.id
  http_method             = aws_api_gateway_method.s3_credentials_redirect.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.s3_credentials.invoke_arn
}

# GET /s3credentialsREADME
resource "aws_api_gateway_resource" "s3_credentials_readme" {
  rest_api_id = var.rest_api_id
  parent_id   = var.rest_api_root_resource_id
  path_part   = "s3credentialsREADME"
}

resource "aws_api_gateway_method" "s3_credentials_readme" {
  rest_api_id   = var.rest_api_id
  resource_id   = aws_api_gateway_resource.s3_credentials_readme.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "s3_credentials_readme" {
  rest_api_id             = var.rest_api_id
  resource_id             = aws_api_gateway_resource.s3_credentials_readme.id
  http_method             = aws_api_gateway_method.s3_credentials_readme.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.s3_credentials.invoke_arn
}

# API deployment
resource "aws_api_gateway_deployment" "s3_credentials" {
  depends_on = [
    aws_api_gateway_integration.s3_credentials_redirect,
    aws_api_gateway_integration.s3_credentials,
    aws_api_gateway_integration.s3_credentials_readme
  ]

  triggers = {
    redeployment = sha1(join(",", list(
      jsonencode( aws_api_gateway_integration.s3_credentials_redirect ),
      jsonencode( aws_api_gateway_integration.s3_credentials ),
      jsonencode( aws_api_gateway_integration.s3_credentials_readme ),
      )))
  }


  rest_api_id = var.rest_api_id
  stage_name  = var.api_gateway_stage

}
