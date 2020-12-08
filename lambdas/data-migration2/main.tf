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

resource "aws_iam_role" "data_migration2" {
  name                 = "${var.prefix}-data-migration2"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn

  tags = var.tags
}

data "aws_iam_policy_document" "data_migration2" {
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
<<<<<<< HEAD
      "dynamodb:GetItem",
=======
>>>>>>> a9be28c72... CUMULUS-2188 initial data-migration2 setup for migrating executions to RDS
    ]
    resources = [
      var.dynamo_tables.executions.arn
    ]
  }

  statement {
    actions = [
      "secretsmanager:GetSecretValue"
    ]
    resources = [var.rds_user_access_secret_arn]
  }
<<<<<<< HEAD
=======

  statement {
    actions   = [
      "kms:Encrypt",
      "kms:Decrypt"
    ]
    resources = [data.aws_kms_key.provider_kms_key.arn]
  }
>>>>>>> a9be28c72... CUMULUS-2188 initial data-migration2 setup for migrating executions to RDS
}

resource "aws_iam_role_policy" "data_migration2" {
  name   = "${var.prefix}_data_migration2"
  role   = aws_iam_role.data_migration2.id
  policy = data.aws_iam_policy_document.data_migration2.json
}

resource "aws_security_group" "data_migration2" {
  count = length(var.lambda_subnet_ids) == 0 ? 0 : 1

<<<<<<< HEAD
  name   = "${var.prefix}-data-migration2"
=======
  name   = "${var.prefix}-data-migration"
>>>>>>> a9be28c72... CUMULUS-2188 initial data-migration2 setup for migrating executions to RDS
  vpc_id = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

resource "aws_lambda_function" "data_migration2" {
  function_name    = "${var.prefix}-data-migration2"
  filename         = local.lambda_path
  source_code_hash = filebase64sha256(local.lambda_path)
  handler          = "index.handler"
  role             = aws_iam_role.data_migration2.arn
  runtime          = "nodejs12.x"
  timeout          = 300
  memory_size      = 512

  environment {
    variables = {
      databaseCredentialSecretArn = var.rds_user_access_secret_arn
      ExecutionsTable = var.dynamo_tables.executions.name
      dbHeartBeat = var.rds_connection_heartbeat
<<<<<<< HEAD
=======
      provider_kms_key_id = var.provider_kms_key_id
>>>>>>> a9be28c72... CUMULUS-2188 initial data-migration2 setup for migrating executions to RDS
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = compact([
        aws_security_group.data_migration2[0].id,
        var.rds_security_group_id
      ])
    }
  }

  tags = var.tags
}
