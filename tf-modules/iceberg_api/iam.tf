# --- Iceberg ECS Task Role ---

data "aws_iam_policy_document" "iceberg_task_assume_role_policy" {
  statement {
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "iceberg_task_role" {
  name                 = "${var.prefix}-iceberg-task-role"
  assume_role_policy   = data.aws_iam_policy_document.iceberg_task_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
}

data "aws_iam_policy_document" "iceberg_task_role_policy" {

  statement {
    actions = [
      "s3:GetBucket*",
      "s3:ListBucket*",
    ]
    resources = [
      "arn:aws:s3:::${var.iceberg_s3_bucket}",
    ]
  }

  statement {
    actions = [
      "s3:GetObject*",
      "s3:ListMultipartUploadParts",
    ]
    resources = [
      "arn:aws:s3:::${var.iceberg_s3_bucket}/*",
    ]
  }

  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:Scan",
      "dynamodb:Query",
    ]
    resources = ["arn:aws:dynamodb:*:*:table/*"]
  }

  statement {
    actions   = ["dynamodb:Query"]
    resources = ["arn:aws:dynamodb:*:*:table/*/index/*"]
  }

  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.api_config_secret_arn]
  }

  # Iceberg-specific: Glue catalog access
  statement {
    actions   = ["glue:*"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "iceberg_task_role_policy" {
  name   = "${var.prefix}-iceberg-task-role-policy"
  role   = aws_iam_role.iceberg_task_role.name
  policy = data.aws_iam_policy_document.iceberg_task_role_policy.json
}
