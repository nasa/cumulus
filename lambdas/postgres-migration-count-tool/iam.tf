data "aws_iam_policy_document" "migration_count_assume_role_policy" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}


resource "aws_security_group" "postgres_migration_count" {
  count = length(var.lambda_subnet_ids) == 0 ? 0 : 1

  name   = "${var.prefix}-postgres-migration-count"
  vpc_id = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

# migration_count_role
resource "aws_iam_role" "postgres_migration_count_role" {
  name                 = "${var.prefix}-postgres_migration_count"
  assume_role_policy   = data.aws_iam_policy_document.migration_count_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
  tags                 = var.tags
}

data "aws_iam_policy_document" "postgres_migration_count_policy" {
  statement {
    actions = [
      "ec2:CreateNetworkInterface",
      "dynamodb:ListTables",
      "ec2:DeleteNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "dynamodb:ListTables",
      "lambda:GetFunction",
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
    ]
    resources = [for b in local.all_bucket_names : "arn:aws:s3:::${b}/*"]
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
      "dynamodb:ListStreams",
    ]
    resources = [for k, v in var.dynamo_tables : "${v.arn}/stream/*"]
  }
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      var.rds_user_access_secret_arn
    ]
  }
}

resource "aws_iam_role_policy" "postgres_migration_count" {
  name   = "${var.prefix}_postgres_migration_count"
  role   = aws_iam_role.postgres_migration_count_role.id
  policy = data.aws_iam_policy_document.postgres_migration_count_policy.json
}
