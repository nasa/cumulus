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

  tags = var.tags
}

data "aws_iam_policy_document" "lambda_api_gateway_policy" {
  statement {
    actions   = ["ecs:RunTask"]
    resources = [
      aws_ecs_task_definition.async_operation.arn,
      aws_ecs_task_definition.dead_letter_recovery_operation.arn
    ]
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
      "lambda:RemovePermission",
      "lambda:GetFunctionConfiguration"
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
    resources = [for b in local.allowed_buckets: "arn:aws:s3:::${b}"]
  }

  statement {
    actions = [
      "s3:GetObject*",
      "s3:PutObject*",
      "s3:ListMultipartUploadParts",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion"
    ]
    resources = [for b in local.allowed_buckets: "arn:aws:s3:::${b}/*"]
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
      "states:StartExecution",
    ]
    resources = ["arn:aws:states:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:stateMachine:${var.prefix}-*"]
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

  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.api_cmr_password.arn,
      aws_secretsmanager_secret.api_launchpad_passphrase.arn,
      aws_secretsmanager_secret.api_config.arn,
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

resource "aws_iam_role_policy" "lambda_api_gateway" {
  name   = "${var.prefix}_lambda_api_gateway_policy"
  role   = aws_iam_role.lambda_api_gateway.id
  policy = data.aws_iam_policy_document.lambda_api_gateway_policy.json
}

# ECS task execution role


resource "aws_iam_role_policy_attachment" "ecr-task-policy-attach" {
  role       = var.ecs_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryFullAccess"
}

resource "aws_iam_role_policy_attachment" "cloudwatch-task-policy-attach" {
  role       = var.ecs_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchFullAccess"
}

# ECS task role

data "aws_iam_policy_document" "ecs_task_role_policy" {
  statement {
    actions = [
      "lambda:GetFunction",
      "lambda:invokeFunction"
    ]
    resources = ["*"]
  }

    statement {
    actions = [
      "s3:GetAccelerateConfiguration",
      "s3:GetBucket*",
      "s3:GetLifecycleConfiguration",
      "s3:GetReplicationConfiguration",
      "s3:ListBucket*",
      "s3:PutAccelerateConfiguration",
      "s3:PutBucket*",
      "s3:PutLifecycleConfiguration",
      "s3:PutReplicationConfiguration"
    ]
    resources = [for b in local.all_bucket_names : "arn:aws:s3:::${b}"]
  }

  statement {
    actions = [
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:GetObject*",
      "s3:ListMultipartUploadParts",
      "s3:PutObject*"
    ]
    resources = [for b in local.all_bucket_names : "arn:aws:s3:::${b}/*"]
  }

  statement {
    actions   = [
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:Scan",
      "dynamodb:Query"
    ]
    resources = [for k, v in var.dynamo_tables : v.arn]
  }

  statement {
    actions   = ["dynamodb:Query"]
    resources = [for k, v in var.dynamo_tables : "${v.arn}/index/*"]
  }

  statement {
    actions = [
      "states:DescribeActivity",
      "states:DescribeExecution",
      "states:GetActivityTask",
      "states:GetExecutionHistory",
      "states:SendTaskFailure",
      "states:SendTaskSuccess"
    ]
    resources = ["arn:aws:states:*:*:*"]
  }

  statement {
    actions = [
      "kinesis:describeStream",
      "kinesis:ListShards",
      "kinesis:getShardIterator",
      "kinesis:GetRecords"
    ]
    resources = ["arn:aws:kinesis:*:*:*"]
  }

  statement {
    actions = [
      "sqs:Send*",
      "sqs:GetQueueUrl",
    ]
    resources = ["arn:aws:sqs:*:*:*"]
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
    actions = ["sns:Publish"]
    resources = [
      aws_sns_topic.report_executions_topic.arn,
      aws_sns_topic.report_granules_topic.arn,
      aws_sns_topic.report_pdrs_topic.arn
    ]
  }
}

resource "aws_iam_role_policy" "ecs_task_role_policy" {
  name   = "${var.prefix}-ecs-task-role-policy"
  role   = var.ecs_task_role.name
  policy = data.aws_iam_policy_document.ecs_task_role_policy.json
}
