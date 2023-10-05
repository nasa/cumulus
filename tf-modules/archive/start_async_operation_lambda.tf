resource "aws_lambda_function" "start_async_operation" {
  function_name    = "${var.prefix}-StartAsyncOperation"
  filename         = "${path.module}/../../packages/api/dist/startAsyncOperation/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/startAsyncOperation/lambda.zip")
  handler          = "index.handler"
  role             = aws_iam_role.start_async_operation.arn
  runtime          = "nodejs16.x"
  timeout          = 300
  memory_size      = lookup(var.lambda_memory_sizes, "start_async_operation_memory_size", 960)
  environment {
    variables = {
      acquireTimeoutMillis         = var.rds_connection_timing_configuration.acquireTimeoutMillis
      AsyncOperationTaskDefinition = aws_ecs_task_definition.async_operation.arn
      createRetryIntervalMillis    = var.rds_connection_timing_configuration.createRetryIntervalMillis
      createTimeoutMillis          = var.rds_connection_timing_configuration.createTimeoutMillis
      databaseCredentialSecretArn  = var.rds_user_access_secret_arn
      EcsCluster                   = var.ecs_cluster_name
      ES_HOST                      = var.elasticsearch_hostname
      idleTimeoutMillis            = var.rds_connection_timing_configuration.idleTimeoutMillis
      reapIntervalMillis           = var.rds_connection_timing_configuration.reapIntervalMillis
      stackName                    = var.prefix
      system_bucket                = var.system_bucket
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

resource "aws_iam_role" "start_async_operation" {
  name                 = "${var.prefix}-start_async_operation"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn

  tags = var.tags
}

resource "aws_iam_role_policy" "start_async_operation" {
  name   = "${var.prefix}_start_async_operation"
  role   = aws_iam_role.start_async_operation.id
  policy = data.aws_iam_policy_document.start_async_operation.json
}

data "aws_iam_policy_document" "start_async_operation" {
  statement {
    actions   = ["ecs:RunTask"]
    resources = [aws_ecs_task_definition.async_operation.arn]
  }

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
      "lambda:GetFunctionConfiguration",
    ]
    resources = ["arn:aws:lambda:*"]
  }

statement {
    actions = [
      "s3:PutObject*",
    ]
    resources = [ "arn:aws:s3:::${var.system_bucket}/*"]
  }

  statement {
    actions = [
      "dynamodb:PutItem",
    ]
    resources = [for k, v in var.dynamo_tables : v.arn]
  }

  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      var.rds_user_access_secret_arn
    ]
  }

  statement {
    actions = [
      "iam:PassRole"
    ]
    resources = [
      var.ecs_execution_role.arn,
      var.ecs_task_role.arn
    ]
  }
}
