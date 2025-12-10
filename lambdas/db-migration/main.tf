locals {
  lambda_path = "${path.module}/dist/webpack/lambda.zip"
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

resource "aws_iam_role" "db_migration" {
  name                 = "${var.prefix}-postgres-db-migration"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn

  tags = var.tags
}

data "aws_iam_policy_document" "db_migration" {
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
  statement {
    actions = [
      "secretsmanager:GetSecretValue"
    ]
    resources = [var.rds_user_access_secret_arn]
  }
}

resource "aws_iam_role_policy" "db_migration" {
  name   = "${var.prefix}_postgres_db_migration"
  role   = aws_iam_role.db_migration.id
  policy = data.aws_iam_policy_document.db_migration.json
}

resource "aws_security_group" "db_migration" {
  count = length(var.subnet_ids) == 0 ? 0 : 1

  name   = "${var.prefix}-postgres-db-migration"
  vpc_id = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

resource "aws_lambda_function" "db_migration" {
  function_name    = "${var.prefix}-postgres-db-migration"
  filename         = local.lambda_path
  source_code_hash = filebase64sha256(local.lambda_path)
  handler          = "index.handler"
  role             = aws_iam_role.db_migration.arn
  runtime          = "nodejs24.x"
  timeout          = var.lambda_timeout
  memory_size      = 512

  environment {
    variables = {
      databaseCredentialSecretArn = var.rds_user_access_secret_arn
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.subnet_ids
      security_group_ids = compact([
        aws_security_group.db_migration[0].id,
        var.rds_security_group_id
      ])
    }
  }

  tags = var.tags
}

data "aws_lambda_invocation" "db_migration" {
  depends_on = [aws_lambda_function.db_migration]
  function_name = aws_lambda_function.db_migration.function_name
  input = jsonencode({
    replacementTrigger = timestamp()
  })
}
