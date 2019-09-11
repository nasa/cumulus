resource "aws_iam_role" "migration_processing" {
  name                 = "${var.prefix}-migration-processing"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
  # TODO Re-enable once IAM permissions have been fixed
  # tags                 = local.default_tags
}

data "aws_iam_policy_document" "migration_processing_policy" {
  statement {
    actions = [
      "cloudformation:DescribeStacks",
      "dynamodb:ListTables",
      "ec2:CreateNetworkInterface",
      "ec2:DeleteNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "events:DeleteRule",
      "events:DescribeRule",
      "events:DisableRule",
      "events:EnableRule",
      "events:ListRules",
      "events:PutRule",
      "kinesis:DescribeStream",
      "kinesis:GetRecords",
      "kinesis:GetShardIterator",
      "kinesis:ListStreams",
      "kinesis:PutRecord",
      "lambda:CreateEventSourceMapping",
      "lambda:GetFunction",
      "lambda:invokeFunction",
      "lambda:ListEventSourceMappings",
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
      "s3:ListAllMyBuckets",
      "sns:List*",
      "sns:publish",
      "states:DescribeActivity",
      "states:DescribeExecution",
      "states:GetActivityTask",
      "states:GetExecutionHistory",
      "states:ListStateMachines",
      "states:SendTaskFailure",
      "states:SendTaskSuccess",
      "states:StartExecution",
      "states:StopExecution",
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "s3:GetAccelerateConfiguration",
      "s3:GetLifecycleConfiguration",
      "s3:GetReplicationConfiguration",
      "s3:GetBucket*",
      "s3:PutAccelerateConfiguration",
      "s3:PutLifecycleConfiguration",
      "s3:PutReplicationConfiguration",
      "s3:PutBucket*",
      "s3:ListBucket*",
    ]
    resources = [for b in flatten([var.public_buckets, var.protected_buckets, var.private_buckets, var.system_bucket]) : "arn:aws:s3:::${b}"]
  }

  statement {
    actions = [
      "s3:AbortMultipartUpload",
      "s3:GetObject*",
      "s3:PutObject*",
      "s3:ListMultipartUploadParts",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
    ]
    resources = [for b in flatten([var.public_buckets, var.protected_buckets, var.private_buckets, var.system_bucket]) : "arn:aws:s3:::${b}/*"]
  }

  statement {
    actions   = ["s3:PutBucketPolicy"]
    resources = [for b in flatten([var.public_buckets, var.protected_buckets, var.private_buckets, var.system_bucket]) : "arn:aws:s3:::${b}"]
  }

  statement {
    actions = [
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Scan",
      "dynamodb:UpdateItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:UpdateContinuousBackups",
      "dynamodb:DescribeContinuousBackups",
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
      "dynamodb:ListStreams",
    ]
    resources = [for k, v in var.dynamo_tables : "${v.arn}/stream/*"]
  }

  statement {
    actions = [
      "sqs:SendMessage",
      "sqs:ReceiveMessage",
      "sqs:ChangeMessageVisibility",
      "sqs:DeleteMessage",
      "sqs:GetQueueUrl",
      "sqs:GetQueueAttributes",
    ]
    resources = ["arn:aws:sqs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:${var.prefix}-*"]
  }
}

resource "aws_iam_role_policy" "migration_processing" {
  role   = aws_iam_role.migration_processing.id
  policy = data.aws_iam_policy_document.migration_processing_policy.json
}

resource "aws_lambda_function" "execute_migrations" {
  function_name    = "${var.prefix}-executeMigrations"
  filename         = "${path.module}/../../packages/api/dist/executeMigrations/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/executeMigrations/lambda.zip")
  handler          = "index.handler"
  role             = aws_iam_role.migration_processing.arn
  runtime          = "nodejs8.10"
  timeout          = 300
  memory_size      = 1024
  environment {
    variables = {
      CMR_ENVIRONMENT           = var.cmr_environment
      ES_HOST                   = var.elasticsearch_hostname
      ExecutionsTable           = var.dynamo_tables.executions.name
      FilesTable                = var.dynamo_tables.files.name
      GranulesTable             = var.dynamo_tables.granules.name
      KinesisInboundEventLogger = var.kinesis_inbound_event_logger_lambda_function_arn
      PdrsTable                 = var.dynamo_tables.pdrs.name
      RulesTable                = var.dynamo_tables.rules.name
      stackName                 = var.prefix
      system_bucket             = var.system_bucket
    }
  }
  tags = merge(local.default_tags, { Project = var.prefix })

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id, var.elasticsearch_security_group_id]
  }
}
