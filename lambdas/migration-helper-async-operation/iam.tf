data "aws_iam_policy_document" "migration_async_operation_assume_role_policy" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_security_group" "migration_helper_async_operation" {
  count = length(var.lambda_subnet_ids) == 0 ? 0 : 1

  name   = "${var.prefix}-migration-helper-async-operation"
  vpc_id = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

resource "aws_iam_role" "migration_helper_async_operation_role" {
  name                 = "${var.prefix}-migration_helper_async_operation"
  assume_role_policy   = data.aws_iam_policy_document.migration_async_operation_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
  tags                 = var.tags
}

data "aws_iam_policy_document" "migration_helper_async_operation_policy" {
  statement {
    actions = [
      "ecs:RunTask",
      "ec2:CreateNetworkInterface",
      "ec2:DeleteNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "lambda:GetFunctionConfiguration",
      "lambda:invokeFunction",
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "s3:GetBucket*",
    ]
    resources = [ "arn:aws:s3:::${var.system_bucket}/*"]
  }

  statement {
    actions = [
      "s3:AbortMultipartUpload",
      "s3:GetObject*",
      "s3:PutObject*",
      "s3:ListMultipartUploadParts",
    ]
    resources = [ "arn:aws:s3:::${var.system_bucket}/*"]
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
      var.ecs_execution_role_arn,
      var.ecs_task_role_arn
    ]
  }
}

resource "aws_iam_role_policy" "migration_helper_async_operation" {
  name   = "${var.prefix}_migration_helper_async_operation"
  role   = aws_iam_role.migration_helper_async_operation_role.id
  policy = data.aws_iam_policy_document.migration_helper_async_operation_policy.json
}
