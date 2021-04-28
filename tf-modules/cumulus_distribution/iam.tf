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
}

resource "aws_iam_role_policy" "lambda_distribution_api_gateway" {
  name   = "${var.prefix}_lambda_distribution_api_gateway_policy"
  role   = aws_iam_role.lambda_distribution_api_gateway.id
  policy = data.aws_iam_policy_document.lambda_distribution_api_gateway_policy.json
}
