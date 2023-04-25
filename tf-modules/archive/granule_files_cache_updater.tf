resource "aws_iam_role" "granule_files_cache_updater_lambda_role" {
  name                 = "${var.prefix}-granuleFilesCacheUpdater"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn

  tags = var.tags
}

data "aws_iam_policy_document" "granule_files_cache_updater_policy_document" {
  statement {
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface"
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents"
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
      "dynamodb:DescribeStream",
      "dynamodb:ListStreams"
    ]
    resources = ["${var.dynamo_tables.granules.arn}/stream/*"]
  }

  statement {
    actions = [
      "dynamodb:BatchWriteItem",
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Scan",
      "dynamodb:UpdateItem"
    ]
    resources = [var.dynamo_tables.files.arn]
  }
}

resource "aws_iam_role_policy" "granule_files_cache_updater_lambda_role_policy" {
  name   = "${var.prefix}_granule_files_cache_updater_lambda_role_policy"
  role   = aws_iam_role.granule_files_cache_updater_lambda_role.id
  policy = data.aws_iam_policy_document.granule_files_cache_updater_policy_document.json
}

resource "aws_lambda_function" "granule_files_cache_updater" {
  depends_on       = [aws_cloudwatch_log_group.granule_files_cache_updater_logs]
  filename         = "${path.module}/../../packages/api/dist/granuleFilesCacheUpdater/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/granuleFilesCacheUpdater/lambda.zip")
  function_name    = "${var.prefix}-granuleFilesCacheUpdater"
  role             = aws_iam_role.granule_files_cache_updater_lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs16.x"
  timeout          = 30
  memory_size      = 256

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [
        aws_security_group.no_ingress_all_egress[0].id
      ]
    }
  }

  environment {
    variables = {
      FilesTable = var.dynamo_tables.files.name
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "granule_files_cache_updater_logs" {
  name              = "/aws/lambda/${var.prefix}-granuleFilesCacheUpdater"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "granuleFilesCacheUpdater", var.default_log_retention_days)
  tags              = var.tags
}

resource "aws_lambda_event_source_mapping" "granule_files_cache_updater" {
  event_source_arn  = data.aws_dynamodb_table.granules.stream_arn
  function_name     = aws_lambda_function.granule_files_cache_updater.arn
  starting_position = "LATEST"
  batch_size        = 10
}
