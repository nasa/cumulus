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
      "states:StopExecution"
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
    resources = ["arn:aws:s3:::${var.prefix}-*"]
  }

  statement {
    actions = [
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:UpdateItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:UpdateContinuousBackups",
      "dynamodb:DescribeContinuousBackups",
    ]
    resources = ["arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/${var.prefix}-*"]
  }

  statement {
    actions = [
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
      "dynamodb:DescribeStream",
      "dynamodb:ListStreams",
    ]
    resources = ["arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/${var.prefix}-*/stream/*"]
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

resource "aws_iam_role_policy" "lambda_processing" {
  role   = aws_iam_role.lambda_processing.id
  policy = data.aws_iam_policy_document.lambda_processing_policy.json
}
