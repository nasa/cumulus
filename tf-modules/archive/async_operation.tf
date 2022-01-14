resource "aws_cloudwatch_log_group" "async_operation" {
  name = "${var.prefix}-AsyncOperationEcsLogs"
  retention_in_days = 30
  tags = var.tags
}

data "aws_iam_policy_document" "ecs_execution_assume_role_policy" {
  statement {
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com", "ec2.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "ecs_execution_role" {
  name                 = "${var.prefix}-ecs-execution_role"
  assume_role_policy   = data.aws_iam_policy_document.ecs_execution_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
}

resource "aws_iam_role_policy_attachment" "ecr-task-policy-attach" {
  role       = aws_iam_role.ecs_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryFullAccess"
}

resource "aws_iam_role_policy_attachment" "cloudwatch-task-policy-attach" {
  role       = aws_iam_role.ecs_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchFullAccess"
}

data "aws_iam_policy_document" "ecs_task_assume_role_policy" {
  statement {
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

data "aws_iam_policy_document" "ecs_task_role_policy" {
  statement {
    actions = [
      "s3:DeleteObject",
      "s3:GetObject"
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "lambda:GetFunction",
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
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      var.rds_user_access_secret_arn
    ]
  }
}

resource "aws_iam_role" "ecs_task_role" {
  name                 = "${var.prefix}-ecs-task_role"
  assume_role_policy   = data.aws_iam_policy_document.ecs_task_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
}

resource "aws_iam_role_policy" "ecs_task_role_policy" {
  name   = "${var.prefix}-ecs-task-role-policy"
  role   = aws_iam_role.ecs_task_role.id
  policy = data.aws_iam_policy_document.ecs_task_role_policy.json
}

resource "aws_ecs_task_definition" "async_operation" {
  family                   = "${var.prefix}-AsyncOperationTaskDefinition"
  tags                     = var.tags
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  execution_role_arn       = aws_iam_role.ecs_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn
  cpu                      = 256
  memory                   = 1024
  container_definitions    = <<EOS
[
  {
    "name": "AsyncOperation",
    "essential": true,
    "environment": [
      {
        "name": "AWS_REGION",
        "value": "${data.aws_region.current.name}"
      },
      {
        "name": "databaseCredentialSecretArn",
        "value": "${var.rds_user_access_secret_arn}"
      }
    ],
    "image": "${var.async_operation_image}",
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "${aws_cloudwatch_log_group.async_operation.name}",
        "awslogs-region": "${data.aws_region.current.name}",
        "awslogs-stream-prefix": "async-operation"
      }
    }
  }
]
EOS
}
