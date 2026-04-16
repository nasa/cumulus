data "aws_iam_policy_document" "iceberg_ecs_task_policy" {
  statement {
    actions = [
      "s3:GetObject",
      "s3:ListBucket",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = [
      "arn:aws:s3:::${var.iceberg_s3_bucket}",
      "arn:aws:s3:::${var.iceberg_s3_bucket}/*",
    ]
  }

  statement {
    actions   = ["glue:*"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "iceberg_ecs_task_policy" {
  name   = "${var.prefix}-iceberg-ecs-task-policy"
  role   = split("/", var.ecs_task_role_arn)[1]
  policy = data.aws_iam_policy_document.iceberg_ecs_task_policy.json
}
