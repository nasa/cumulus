data "aws_iam_policy_document" "ec2_assume_role_policy" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "lambda_assume_role_policy" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# lambda-processing role

resource "aws_iam_role" "lambda_processing" {
  name                 = "${var.prefix}-lambda-processing"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
  tags                 = var.tags
}

data "aws_iam_policy_document" "lambda_processing_policy" {
  statement {
    actions = [
      "ec2:CreateNetworkInterface",
      "sns:publish",
      "cloudformation:DescribeStacks",
      "dynamodb:ListTables",
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
      "lambda:GetFunction",
      "lambda:invokeFunction",
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
      "s3:ListAllMyBuckets",
      "sns:List*",
      "states:DescribeActivity",
      "states:DescribeExecution",
      "states:GetActivityTask",
      "states:GetExecutionHistory",
      "states:ListStateMachines",
      "states:SendTaskFailure",
      "states:SendTaskSuccess",
      "states:StartExecution",
      "states:StopExecution",
      "sqs:SendMessage",
      "sqs:ReceiveMessage",
      "sqs:ChangeMessageVisibility",
      "sqs:DeleteMessage",
      "sqs:GetQueueUrl",
      "sqs:GetQueueAttributes",
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
    resources = [for b in local.all_bucket_names : "arn:aws:s3:::${b}"]
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
    resources = [for b in local.all_bucket_names : "arn:aws:s3:::${b}/*"]
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
    actions   = ["kms:Decrypt"]
    resources = [module.archive.provider_kms_key_arn]
  }

  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      module.archive.cmr_password_secret_arn,
      module.archive.launchpad_passphrase_secret_arn,
    ]
  }
}

resource "aws_iam_role_policy" "lambda_processing" {
  name   = "${var.prefix}_lambda_processing_policy"
  role   = aws_iam_role.lambda_processing.id
  policy = data.aws_iam_policy_document.lambda_processing_policy.json
}

# ECS task execution role

data "aws_iam_policy_document" "ecs_execution_assume_role_policy" {
  statement {
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com", "ec2.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "ecs_execution_role" {
  name                 = "${var.prefix}-ecs-execution-role"
  assume_role_policy   = data.aws_iam_policy_document.ecs_execution_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
}

# ECS task role

data "aws_iam_policy_document" "ecs_task_assume_role_policy" {
  statement {
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "ecs_task_role" {
  name                 = "${var.prefix}-ecs-task-role"
  assume_role_policy   = data.aws_iam_policy_document.ecs_task_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
}

