terraform {
  required_providers {
    aws = ">= 2.31.0"
  }
}

locals {
  cluster_name = reverse(split("/", var.cluster_arn))[0]
  full_name    = "${var.prefix}-${var.name}"
}

data "aws_region" "current" {}

resource "aws_cloudwatch_log_group" "default" {
  name              = "${local.full_name}EcsLogs"
  retention_in_days = 30
  tags              = var.tags
}

resource "aws_ecs_task_definition" "default" {
  family       = local.full_name
  network_mode = var.network_mode

  container_definitions = jsonencode([
    {
      name              = local.full_name
      cpu               = var.cpu
      essential         = true
      mountPoints       = [for k, v in var.volumes : { sourceVolume = v.name, containerPath = v.container_path }]
      privileged        = var.privileged
      environment       = [for k, v in var.environment : { name = k, value = v }]
      image             = var.image
      memoryReservation = var.memory_reservation
      command           = var.command
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group  = aws_cloudwatch_log_group.default.name
          awslogs-region = data.aws_region.current.name
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
  name            = "${local.full_name}-default"
  destination_arn = var.log2elasticsearch_lambda_function_arn
  log_group_name  = aws_cloudwatch_log_group.default.name
  filter_pattern  = ""
}

resource "aws_ecs_service" "default" {
  name                               = local.full_name
  cluster                            = var.cluster_arn
  desired_count                      = var.desired_count
  task_definition                    = aws_ecs_task_definition.default.arn
  deployment_maximum_percent         = 100
  deployment_minimum_healthy_percent = 0
  # TODO Re-enable tags once this warning is addressed:
  #   The new ARN and resource ID format must be enabled to add tags to the
  #   service. Opt in to the new format and try again.
  #
  # tags                               = var.tags
}

resource "aws_cloudwatch_metric_alarm" "custom" {
  for_each = var.alarms

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
    ServiceName = aws_ecs_service.default.name
  }
  tags = var.tags
}
