resource "aws_iam_role" "fargate_task_role" {
  name = "${var.prefix}-fargate-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Principal = {
          Service = [
            "ecs-tasks.amazonaws.com",
            "glue.amazonaws.com"
          ]
        },
        Action = "sts:AssumeRole"
      },
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
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:CreateBucket",
          "s3:AbortMultipartUpload"
        ],
        Resource = [
          "arn:aws:s3:::${var.iceberg_s3_bucket}",
          "arn:aws:s3:::${var.iceberg_s3_bucket}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_policy" "athena_access_policy" {
  name        = "${var.prefix}-fargate-athena-access-policy"
  description = "IAM policy for Fargate task to access Athena"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        # Athena Permissions
        Effect = "Allow"
        Action = [
          "athena:StartQueryExecution",
          "athena:StopQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:GetQueryResultsStream",
          "athena:ListQueryExecutions",
          "athena:GetWorkGroup",
          "athena:GetDataCatalog"
        ]
        Resource = [
          "arn:aws:athena:${var.region}:${data.aws_caller_identity.current.account_id}:workgroup/*",
          "arn:aws:athena:${var.region}:${data.aws_caller_identity.current.account_id}:datacatalog/*"
        ]
      },
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
      },
      {
        # Allow the task to pass this role to Glue when registering the optimizer
        Effect = "Allow"
        Action = "iam:PassRole"
        # Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.prefix}-fargate-task-role"
        Resource = aws_iam_role.fargate_task_role.arn
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

resource "aws_iam_policy" "ssm_access_policy" {
  name        = "${var.prefix}-fargate-ssm-access-policy"
  description = "IAM policy for Fargate task to access SSM"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        "Effect" : "Allow",
        "Action" : [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel"
        ],
        "Resource" : "*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "attach_s3_policy" {
  role       = aws_iam_role.fargate_task_role.name
  policy_arn = aws_iam_policy.s3_access_policy.arn
}

resource "aws_iam_role_policy_attachment" "attach_athena_policy" {
  role       = aws_iam_role.fargate_task_role.name
  policy_arn = aws_iam_policy.athena_access_policy.arn
}

resource "aws_iam_role_policy_attachment" "attach_glue_policy" {
  role       = aws_iam_role.fargate_task_role.name
  policy_arn = aws_iam_policy.glue_access_policy.arn
}

resource "aws_iam_role_policy_attachment" "attach_ssm_policy" {
  role       = aws_iam_role.fargate_task_role.name
  policy_arn = aws_iam_policy.ssm_access_policy.arn
}

resource "aws_iam_role_policy_attachment" "attach_rds_policy" {
  role       = aws_iam_role.fargate_task_role.name
  policy_arn = aws_iam_policy.rds_access_policy.arn
}


resource "aws_iam_role" "ecs_infrastructure_role" {
  name = "${var.prefix}-ecs-infrastructure-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs.amazonaws.com" # Note: ecs, not ecs-tasks
      }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ecs_volumes_attachment" {
  role       = aws_iam_role.ecs_infrastructure_role.name
  policy_arn = data.aws_iam_policy.ECSInfrastructure.arn
}
