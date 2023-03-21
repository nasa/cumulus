locals {
  lambda_path = "${path.module}/dist/webpack/lambda.zip"
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

resource "aws_iam_role" "data_migration1" {
  name                 = "${var.prefix}-data-migration1"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn

  tags = var.tags
}

data "aws_iam_policy_document" "data_migration1" {
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
    ]
    resources = [
      var.dynamo_tables.async_operations.arn,
      var.dynamo_tables.collections.arn,
      var.dynamo_tables.providers.arn,
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

resource "aws_iam_role_policy" "data_migration1" {
  name   = "${var.prefix}_data_migration1"
  role   = aws_iam_role.data_migration1.id
  policy = data.aws_iam_policy_document.data_migration1.json
}

resource "aws_security_group" "data_migration1" {
  count = length(var.lambda_subnet_ids) == 0 ? 0 : 1

  name   = "${var.prefix}-data-migration1"
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
  filename         = local.lambda_path
  source_code_hash = filebase64sha256(local.lambda_path)
  handler          = "index.handler"
  role             = aws_iam_role.data_migration1.arn
  runtime          = "nodejs16.x"
  timeout          = 300
  memory_size      = 512

  environment {
    variables = {
      acquireTimeoutMillis                  = var.rds_connection_timing_configuration.acquireTimeoutMillis
      AsyncOperationsTable = var.dynamo_tables.async_operations.name
      CollectionsTable = var.dynamo_tables.collections.name
      createRetryIntervalMillis             = var.rds_connection_timing_configuration.createRetryIntervalMillis
      createTimeoutMillis                   = var.rds_connection_timing_configuration.createTimeoutMillis
      databaseCredentialSecretArn = var.rds_user_access_secret_arn
      idleTimeoutMillis                     = var.rds_connection_timing_configuration.idleTimeoutMillis
      provider_kms_key_id = var.provider_kms_key_id
      ProvidersTable = var.dynamo_tables.providers.name
      reapIntervalMillis                    = var.rds_connection_timing_configuration.reapIntervalMillis
      RulesTable = var.dynamo_tables.rules.name
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = compact([
        aws_security_group.data_migration1[0].id,
        var.rds_security_group_id
      ])
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "data_migration1" {
  name              = "/aws/lambda/${aws_lambda_function.data_migration1.function_name}"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "dataMigration1_log_retention", var.default_log_retention_days)
  tags              = var.tags
}
