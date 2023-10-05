resource "aws_lambda_function" "index_from_database" {
  function_name    = "${var.prefix}-IndexFromDatabase"
  filename         = "${path.module}/../../packages/api/dist/indexFromDatabase/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/indexFromDatabase/lambda.zip")
  handler          = "index.handler"
  role             = aws_iam_role.index_from_database.arn
  runtime          = "nodejs16.x"
  timeout          = 300
  memory_size      = lookup(var.lambda_memory_sizes, "index_from_database_memory_size", 512)
  environment {
    variables = {
      CMR_ENVIRONMENT             = var.cmr_environment
      CMR_HOST                    = var.cmr_custom_host
      databaseCredentialSecretArn = var.rds_user_access_secret_arn
      ES_CONCURRENCY              = var.es_request_concurrency
      ES_HOST                     = var.elasticsearch_hostname
      ReconciliationReportsTable  = var.dynamo_tables.reconciliation_reports.name
      stackName                   = var.prefix
    }
  }
  tags = var.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = concat(local.lambda_security_group_ids, [var.rds_security_group])
    }
  }
}


resource "aws_iam_role" "index_from_database" {
  name                 = "${var.prefix}-index_from_database"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn

  tags = var.tags
}


resource "aws_iam_role_policy" "index_from_database" {
  name   = "${var.prefix}_index_from_database_policy"
  role   = aws_iam_role.index_from_database.id
  policy = data.aws_iam_policy_document.index_from_database.json
}


data "aws_iam_policy_document" "index_from_database" {
  statement {
    actions   = ["ecs:RunTask"]
    resources = [aws_ecs_task_definition.async_operation.arn]
  }

  statement {
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DeleteNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "logs:DescribeLogStreams",
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:Scan",
    ]
    resources = [for k, v in var.dynamo_tables : v.arn]
  }

  statement {
    actions   = ["dynamodb:Query"]
    resources = [for k, v in var.dynamo_tables : "${v.arn}/index/*"]
  }

  statement {
    actions = [
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
      "dynamodb:DescribeStream",
      "dynamodb:ListStreams"
    ]
    resources = [for k, v in var.dynamo_tables : "${v.arn}/stream/*"]
  }

  statement {
    actions   = ["dynamodb:ListTables"]
    resources = ["*"]
  }

  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.api_cmr_password.arn,
      aws_secretsmanager_secret.api_launchpad_passphrase.arn,
      var.rds_user_access_secret_arn
    ]
  }

  statement {
    actions = [
      "ssm:GetParameter"
    ]
    resources = [aws_ssm_parameter.dynamo_table_names.arn]
  }
}

