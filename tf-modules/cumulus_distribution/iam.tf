data "aws_iam_policy_document" "lambda_assume_role_policy" {
  statement {
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

# lambda-distribution-api-gateway role

resource "aws_iam_role" "lambda_distribution_api_gateway" {
  name                 = "${var.prefix}-lambda-distribution-api-gateway"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn

  tags = var.tags
}

data "aws_iam_policy_document" "lambda_distribution_api_gateway_policy" {
  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:*:*:*"]
  }

  statement {
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface",
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem"
    ]
    resources = [aws_dynamodb_table.access_tokens.arn]
  }

  statement {
    actions = [
      "s3:GetObject*"
    ]
    resources = [for b in local.allowed_buckets: "arn:aws:s3:::${b}/*"]
  }

  statement {
    actions   = [
      "s3:PutObject"
    ]
    resources = ["arn:aws:s3:::${var.system_bucket}/${local.distribution_bucket_map_key}"]
  }

  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.api_oauth_client_password.arn
    ]
  }

  dynamic "statement" {
    for_each = var.sts_credentials_lambda_function_arn != null ? [1] : []
    content {
      actions   = ["lambda:InvokeFunction"]
      resources = [var.sts_credentials_lambda_function_arn, var.sts_policy_helper_lambda_function_arn]
    }
  }
}

resource "aws_iam_role_policy" "lambda_distribution_api_gateway" {
  name   = "${var.prefix}_lambda_distribution_api_gateway_policy"
  role   = aws_iam_role.lambda_distribution_api_gateway.id
  policy = data.aws_iam_policy_document.lambda_distribution_api_gateway_policy.json
}
