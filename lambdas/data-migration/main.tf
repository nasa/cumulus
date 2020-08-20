locals {
  lambda_path = "${path.module}/dist/lambda.zip"
}

data "aws_iam_policy_document" "lambda_assume_role_policy" {
  statement {
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "data_migration" {
  name                 = "${var.prefix}-data-migration"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn

  tags = var.tags
}

data "aws_iam_policy_document" "data_migration" {
  statement {
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DeleteNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "data_migration" {
  name   = "${var.prefix}_data_migration"
  role   = aws_iam_role.data_migration.id
  policy = data.aws_iam_policy_document.data_migration.json
}

resource "aws_security_group" "data_migration" {
  count = length(var.subnet_ids) == 0 ? 0 : 1

  name   = "${var.prefix}-data-migration"
  vpc_id = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

resource "aws_lambda_function" "data_migration" {
  function_name    = "${var.prefix}-data-migration"
  filename         = local.lambda_path
  source_code_hash = filebase64sha256(local.lambda_path)
  handler          = "index.handler"
  role             = aws_iam_role.data_migration.arn
  runtime          = "nodejs12.x"
  timeout          = 60
  memory_size      = 128

  environment {
    variables = {
      PG_HOST = var.pg_host
      PG_USER = var.pg_user
      PG_PASSWORD = var.pg_password
      PG_DATABASE = var.pg_database
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.subnet_ids
      security_group_ids = [
        aws_security_group.data_migration[0].id
      ]
    }
  }

  tags = var.tags
}
