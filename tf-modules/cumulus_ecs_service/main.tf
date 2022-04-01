terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 3.0,!= 3.14.0"
    }
  }
}


data "aws_ecs_cluster" "ecs_cluster" {
  cluster_name = var.cluster_name
}

locals {
  cluster_name        = reverse(split("/", data.aws_ecs_cluster.ecs_cluster.arn))[0]
  full_name           = "${var.prefix}-${var.name}"
  compatibilites      = var.use_fargate ? ["FARGATE"] : ["EC2"]
  alarms              = var.use_fargate ? {} : var.alarms
}

data "aws_region" "current" {}

resource "aws_cloudwatch_log_group" "default" {
  name              = "${local.full_name}EcsLogs"
  retention_in_days = 30
  tags              = var.tags
}

resource "aws_ecs_task_definition" "default" {
  count = var.use_fargate ? 0 : 1
  family       = local.full_name
  network_mode = var.network_mode
  requires_compatibilities = local.compatibilites

  container_definitions = jsonencode([
    {
      name               = local.full_name
      cpu                = var.cpu
      essential          = true
      mountPoints        = [for k, v in var.volumes : { sourceVolume = v.name, containerPath = v.container_path }]
      privileged         = var.privileged
      environment        = [for k, v in var.environment : { name = k, value = v }]
      image              = var.image
      memoryReservation  = var.memory_reservation
      command            = var.command
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group  = aws_cloudwatch_log_group.default.name
          awslogs-region = data.aws_region.current.name
        }
      }
    }
  ])
}

  resource "aws_ecs_task_definition" "fargate" {
  count = var.use_fargate ? 1 : 0

  family       = "${local.full_name}-fg"
  network_mode = "awsvpc"
  requires_compatibilities = local.compatibilites
  execution_role_arn = var.execution_role_arn
  task_role_arn = var.task_role_arn
  cpu                = var.cpu
  memory             = var.memory_reservation

  container_definitions = jsonencode([
    {
      name               = "${local.full_name}-fg"
      essential          = true
      mountPoints        = [for k, v in var.volumes : { sourceVolume = v.name, containerPath = v.container_path }]
      privileged         = var.privileged
      environment        = [for k, v in var.environment : { name = k, value = v }]
      image              = var.image
      command            = var.command
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group  = "${aws_cloudwatch_log_group.default.name}-fg"
          awslogs-region = data.aws_region.current.name
          awslogs-create-group = "true"
          awslogs-stream-prefix = local.full_name
        }
      }
    }
  ])

  dynamic "volume" {
    for_each = var.volumes
    content {
      name      = volume.value.name
      host_path = volume.value.host_path
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_subscription_filter" "default" {
  count = var.log_destination_arn != null ? 1 : 0
  name            = "${local.full_name}-default"
  destination_arn = var.log_destination_arn
  log_group_name  = aws_cloudwatch_log_group.default.name
  filter_pattern  = ""
}

resource "aws_ecs_service" "default" {
  count = var.use_fargate ? 0 : 1
  name                               = local.full_name
  cluster                            = data.aws_ecs_cluster.ecs_cluster.arn
  desired_count                      = var.desired_count
  task_definition                    = aws_ecs_task_definition.default[0].arn
  deployment_maximum_percent         = 100
  deployment_minimum_healthy_percent = 0
  # TODO Re-enable tags once this warning is addressed:
  #   The new ARN and resource ID format must be enabled to add tags to the
  #   service. Opt in to the new format and try again.
  #
  # tags                               = var.tags
}


resource "aws_ecs_service" "fargate" {
  count = var.use_fargate ? 1 : 0
  name                               = "${local.full_name}-fg"
  cluster                            = data.aws_ecs_cluster.ecs_cluster.arn
  desired_count                      = var.desired_count
  launch_type                        = "FARGATE"
  task_definition                    = aws_ecs_task_definition.fargate[0].arn
  network_configuration {
        subnets = var.use_fargate ? var.subnet_ids : []
  }
  deployment_maximum_percent         = 100
  deployment_minimum_healthy_percent = 0
  # TODO Re-enable tags once this warning is addressed:
  #   The new ARN and resource ID format must be enabled to add tags to the
  #   service. Opt in to the new format and try again.
  #
  # tags                               = var.tags
}

resource "aws_cloudwatch_metric_alarm" "custom" {
  for_each = local.alarms
  alarm_description   = lookup(each.value, "description", null)
  alarm_name          = "${local.full_name}-${each.key}"
  comparison_operator = each.value.comparison_operator
  evaluation_periods  = lookup(each.value, "evaluation_periods", 5)
  metric_name         = each.value.metric_name
  statistic           = lookup(each.value, "statistic", "Average")
  threshold           = each.value.threshold
  period              = lookup(each.value, "period", 60)
  namespace           = "AWS/ECS"
  dimensions = {
    ClusterName = local.cluster_name
    ServiceName = aws_ecs_service.default[0].name
  }
  tags = var.tags
}
