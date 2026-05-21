terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.100, < 6.0.0"
    }
  }
}

locals {
  full_name = "${var.prefix}-iceberg-cleanup"
}

data "aws_caller_identity" "current" {}

resource "aws_ecs_task_definition" "iceberg_cleanup" {
  family                   = "${var.prefix}-iceberg-cleanup"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  runtime_platform {
    cpu_architecture = var.cpu_architecture
  }
  memory             = var.memory
  execution_role_arn = var.ecs_task_execution_role.arn
  task_role_arn      = aws_iam_role.iceberg_cleanup.arn

  container_definitions = jsonencode([
    {
      name      = local.full_name
      essential = true
      command = [
        "python3", "./scripts/cleanup_snapshots.py",
        "--namespace", var.iceberg_namespace,
        "--tables", var.table_include_list,
        "--warehouse", "s3://${var.iceberg_s3_bucket}/warehouse",
        "--region", var.region,
        "--jars-dir", "./scripts/jars",
        "--older-than-minutes", tostring(var.older_than_minutes),
        "--retain-last", tostring(var.retain_last)
      ]
      environment = [
        { name = "AWS_DEFAULT_REGION", value = var.region }
      ]
      image = var.iceberg_cleanup_image
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.iceberg_cleanup_logs.name
          awslogs-region        = var.region
          awslogs-stream-prefix = local.full_name
        }
      }
    }
  ])

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "iceberg_cleanup_logs" {
  name              = "/aws/ecs/cluster/${local.full_name}/iceberg-cleanup"
  retention_in_days = 1
}

resource "aws_scheduler_schedule" "iceberg_cleanup" {
  name       = local.full_name
  group_name = "default"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression = "rate(${var.cleanup_interval_minutes} minutes)"

  target {
    arn      = var.ecs_cluster.arn
    role_arn = aws_iam_role.scheduler.arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.iceberg_cleanup.arn
      launch_type         = "FARGATE"

      network_configuration {
        subnets          = [var.subnet]
        security_groups  = [var.task_security_group_id]
        assign_public_ip = false
      }
    }
  }
}
