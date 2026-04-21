resource "aws_iam_role" "ecs_task_execution_role" {
  name = "${var.prefix}-ecs-task-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_role_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  # AWS managed policy for basic ECS execution permissions
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "fargate_task_role" {
  name = "${var.prefix}-fargate-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        },
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_policy" "s3_access_policy" {
  name        = "${var.prefix}-fargate-s3-access-policy"
  description = "IAM policy for Fargate task to access S3"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "s3:GetObject",
          "s3:ListBucket",
          "s3:PutObject",
          "s3:DeleteObject"
        ],
        Resource = [
          "arn:aws:s3:::${var.iceberg_s3_bucket}",
          "arn:aws:s3:::${var.iceberg_s3_bucket}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_policy" "glue_access_policy" {
  name        = "${var.prefix}-fargate-glue-access-policy"
  description = "IAM policy for Fargate task to access AWS Glue"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "glue:*"
        ],
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_policy" "rds_access_policy" {
  name        = "${var.prefix}-fargate-rds-access-policy"
  description = "IAM policy for Fargate task to access RDS"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "rds-db:connect"
        ],
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "attach_s3_policy" {
  role       = aws_iam_role.fargate_task_role.name
  policy_arn = aws_iam_policy.s3_access_policy.arn
}

resource "aws_iam_role_policy_attachment" "attach_glue_policy" {
  role       = aws_iam_role.fargate_task_role.name
  policy_arn = aws_iam_policy.glue_access_policy.arn
}

resource "aws_iam_role" "ecs_infrastructure_role" {
  name = "${var.prefix}-ecs-infrastructure-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs.amazonaws.com"  # Note: ecs, not ecs-tasks
      }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ecs_volumes_attachment" {
  role       = aws_iam_role.ecs_infrastructure_role.name
  policy_arn = data.aws_iam_policy.ECSInfrastructure.arn
}
