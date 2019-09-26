data "aws_iam_policy_document" "lambda_assume_role_policy" {
  statement {
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

# lambda-api-gateway role

resource "aws_iam_role" "lambda_api_gateway" {
  name                 = "${var.prefix}-lambda-api-gateway"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
  # TODO Re-enable once IAM permissions have been fixed
  # tags                 = local.default_tags
}

data "aws_iam_policy_document" "lambda_api_gateway_policy" {
  statement {
    actions   = ["ecs:RunTask"]
    resources = [aws_ecs_task_definition.async_operation.arn]
  }

  statement {
    actions = [
      "logs:DescribeLogStreams",
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "lambda:GetFunction",
      "lambda:invokeFunction",
      "lambda:CreateEventSourceMapping",
      "lambda:UpdateEventSourceMapping",
      "lambda:DeleteEventSourceMapping",
      "lambda:GetEventSourceMapping",
      "lambda:ListEventSourceMappings",
      "lambda:AddPermission",
      "lambda:RemovePermission"
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Scan",
      "dynamodb:UpdateItem"
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
    actions = [
      "s3:GetAccelerateConfiguration",
      "s3:GetLifecycleConfiguration",
      "s3:GetReplicationConfiguration",
      "s3:GetBucket*",
      "s3:PutAccelerateConfiguration",
      "s3:PutLifecycleConfiguration",
      "s3:PutReplicationConfiguration",
      "s3:PutBucket*",
      "s3:ListBucket*"
    ]
    resources = [for b in flatten([var.public_buckets, var.protected_buckets, var.private_buckets, var.system_bucket]) : "arn:aws:s3:::${b}"]
  }

  statement {
    actions = [
      "s3:GetObject*",
      "s3:PutObject*",
      "s3:ListMultipartUploadParts",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion"
    ]
    resources = [for b in flatten([var.public_buckets, var.protected_buckets, var.private_buckets, var.system_bucket]) : "arn:aws:s3:::${b}/*"]
  }

  statement {
    actions   = ["s3:ListAllMyBuckets"]
    resources = ["*"]
  }

  statement {
    actions = [
      "sns:publish",
      "sns:Subscribe",
      "sns:Unsubscribe",
      "sns:List*",
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "sqs:GetQueueUrl",
      "sqs:GetQueueAttributes",
      "sqs:SendMessage",
    ]
    resources = ["arn:aws:sqs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:${var.prefix}-*"]
  }

  statement {
    actions = [
      "cloudwatch:List*",
      "cloudwatch:Get*",
      "cloudwatch:Describe*",
    ]
    resources = ["*"]
  }

  statement {
    actions   = ["apigateway:GET"]
    resources = ["arn:aws:apigateway:${data.aws_region.current.name}::/restapis/*/stages"]
  }

  statement {
    actions = [
      "events:DisableRule",
      "events:DeleteRule",
      "events:EnableRule",
      "events:ListRules",
      "events:PutRule",
      "events:DescribeRule",
      "events:PutTargets",
      "events:RemoveTargets",
    ]
    resources = ["arn:aws:events:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:rule/${var.prefix}-*"]
  }

  statement {
    actions = [
      "states:DescribeExecution",
      "states:DescribeStateMachine",
      "states:GetExecutionHistory",
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "lambda_api_gateway" {
  role   = aws_iam_role.lambda_api_gateway.id
  policy = data.aws_iam_policy_document.lambda_api_gateway_policy.json
}
