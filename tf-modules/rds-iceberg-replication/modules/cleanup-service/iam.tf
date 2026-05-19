resource "aws_iam_role" "iceberg_cleanup" {
  name = local.full_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
        Action    = "sts:AssumeRole"
      },
      # Also allow Glue to assume this role for the orphan file deletion optimizer
      {
        Effect    = "Allow"
        Principal = { Service = "glue.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "iceberg_cleanup_s3" {
  name = "${local.full_name}-s3"
  role = aws_iam_role.iceberg_cleanup.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:DeleteObject", "s3:PutObject"]
        Resource = "arn:aws:s3:::${var.iceberg_s3_bucket}/warehouse/${var.iceberg_namespace}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = "arn:aws:s3:::${var.iceberg_s3_bucket}"
      }
    ]
  })
}

resource "aws_iam_role_policy" "iceberg_cleanup_glue" {
  name = "${local.full_name}-glue"
  role = aws_iam_role.iceberg_cleanup.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Read table metadata (needed by both the ECS task and Glue orphan file optimizer)
        Effect = "Allow"
        Action = ["glue:GetTable"]
        Resource = [
          "arn:aws:glue:${var.region}:${data.aws_caller_identity.current.account_id}:catalog",
          "arn:aws:glue:${var.region}:${data.aws_caller_identity.current.account_id}:database/${var.iceberg_namespace}",
          "arn:aws:glue:${var.region}:${data.aws_caller_identity.current.account_id}:table/${var.iceberg_namespace}/*"
        ]
      },
      {
        # Manage orphan file deletion optimizers on all tables in the namespace
        Effect = "Allow"
        Action = [
          "glue:CreateTableOptimizer",
          "glue:UpdateTableOptimizer",
          "glue:GetTableOptimizer",
          "glue:ListTableOptimizers",
          "glue:UpdateTable"
        ]
        Resource = [
          "arn:aws:glue:${var.region}:${data.aws_caller_identity.current.account_id}:catalog",
          "arn:aws:glue:${var.region}:${data.aws_caller_identity.current.account_id}:database/${var.iceberg_namespace}",
          "arn:aws:glue:${var.region}:${data.aws_caller_identity.current.account_id}:table/${var.iceberg_namespace}/*"
        ]
      },
      {
        # Allow the task to pass this role to Glue when registering the optimizer
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${local.full_name}"
      }
    ]
  })
}

resource "aws_iam_role_policy" "iceberg_cleanup_logs" {
  name = "${local.full_name}-logs"
  role = aws_iam_role.iceberg_cleanup.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws-glue/iceberg-orphan-file-deletion/logs:*"
      }
    ]
  })
}

# Role that allows EventBridge Scheduler to launch the Fargate task
resource "aws_iam_role" "scheduler" {
  name = "${local.full_name}-scheduler"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "scheduler" {
  name = "${local.full_name}-scheduler"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "ecs:RunTask"
        Resource = aws_ecs_task_definition.iceberg_cleanup.arn
      },
      {
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          var.ecs_task_execution_role.arn,
          aws_iam_role.iceberg_cleanup.arn
        ]
      }
    ]
  })
}
