locals {
  lambda_path1 = "${path.module}/../../lambdas/data-migration1/dist/webpack/lambda.zip"
  lambda_path2 = "${path.module}/../../lambdas/data-migration2/dist/webpack/lambda.zip"
}

data "aws_kms_key" "provider_kms_key" {
  key_id = var.provider_kms_key_id
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

  statement {
    actions = [
      "dynamodb:Scan",
      "dynamodb:GetItem",
    ]
    resources = [
      var.dynamo_tables.async_operations.arn,
      var.dynamo_tables.collections.arn,
      var.dynamo_tables.providers.arn,
      var.dynamo_tables.executions.arn,
      var.dynamo_tables.rules.arn
    ]
  }

  statement {
    actions = [
      "secretsmanager:GetSecretValue"
    ]
    resources = [var.rds_user_access_secret_arn]
  }

  statement {
    actions   = [
      "kms:Encrypt",
      "kms:Decrypt"
    ]
    resources = [data.aws_kms_key.provider_kms_key.arn]
  }
}

resource "aws_iam_role_policy" "data_migration" {
  name   = "${var.prefix}_data_migration"
  role   = aws_iam_role.data_migration.id
  policy = data.aws_iam_policy_document.data_migration.json
}

resource "aws_security_group" "data_migration" {
  count = length(var.lambda_subnet_ids) == 0 ? 0 : 1

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

resource "aws_lambda_function" "data_migration1" {
  function_name    = "${var.prefix}-data-migration1"
  filename         = local.lambda_path1
  source_code_hash = filebase64sha256(local.lambda_path1)
  handler          = "index.handler"
  role             = aws_iam_role.data_migration.arn
  runtime          = "nodejs12.x"
  timeout          = 300
  memory_size      = 512

  environment {
    variables = {
      AsyncOperationsTable = var.dynamo_tables.async_operations.name
      CollectionsTable = var.dynamo_tables.collections.name
      databaseCredentialSecretArn = var.rds_user_access_secret_arn
      dbHeartBeat = var.rds_connection_heartbeat
      ProvidersTable = var.dynamo_tables.providers.name
      provider_kms_key_id = var.provider_kms_key_id
      RulesTable = var.dynamo_tables.rules.name
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = compact([
        aws_security_group.data_migration[0].id,
        var.rds_security_group_id
      ])
    }
  }

  tags = var.tags
}

resource "aws_lambda_function" "data_migration2" {
  function_name    = "${var.prefix}-data-migration2"
  filename         = local.lambda_path2
  source_code_hash = filebase64sha256(local.lambda_path2)
  handler          = "index.handler"
  role             = aws_iam_role.data_migration.arn
  runtime          = "nodejs12.x"
  timeout          = 300
  memory_size      = 512

  environment {
    variables = {
      databaseCredentialSecretArn = var.rds_user_access_secret_arn
      ExecutionsTable = var.dynamo_tables.executions.name
      dbHeartBeat = var.rds_connection_heartbeat
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = compact([
        aws_security_group.data_migration[0].id,
        var.rds_security_group_id
      ])
    }
  }

  tags = var.tags
}
