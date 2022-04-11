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

  family                   = "${local.full_name}-fg"
  network_mode             = "awsvpc"
  requires_compatibilities = local.compatibilites
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn
  cpu                      = var.cpu
  memory                   = var.memory_reservation

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

resource "aws_appautoscaling_target" "fargate_ecs_service_target" {
  count = var.use_fargate ? 1 : 0
  max_capacity       = var.fargate_max_capacity
  min_capacity       = var.fargate_min_capacity
  resource_id        = "service/${local.cluster_name}/${aws_ecs_service.fargate[0].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "ecs_policy_fargate_up" {
  count = var.use_fargate ? 1 : 0
  name               =  "${local.full_name}-fg-upscale"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.fargate_ecs_service_target[0].resource_id
  scalable_dimension = aws_appautoscaling_target.fargate_ecs_service_target[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.fargate_ecs_service_target[0].service_namespace

  step_scaling_policy_configuration {
    adjustment_type = "PercentChangeInCapacity"
    cooldown = var.fargate_scaling_cooldown
    metric_aggregation_type = "Average"
    min_adjustment_magnitude = 1
    step_adjustment {
      metric_interval_lower_bound = 0
      metric_interval_upper_bound = 30000
      scaling_adjustment          = var.fargate_upscale_adjustment
    }
    step_adjustment {
      metric_interval_lower_bound = 30000
      metric_interval_upper_bound = 120000
      scaling_adjustment          = var.fargate_upscale_adjustment * 2
    }
    step_adjustment {
      metric_interval_lower_bound = 120000
      scaling_adjustment          = var.fargate_upscale_adjustment * 5
    }
  }
}

resource "aws_appautoscaling_policy" "ecs_policy_fargate_down" {
  count = var.use_fargate ? 1 : 0
  name               = "${local.full_name}-fg-downscale"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.fargate_ecs_service_target[0].resource_id
  scalable_dimension = aws_appautoscaling_target.fargate_ecs_service_target[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.fargate_ecs_service_target[0].service_namespace

  step_scaling_policy_configuration {
    adjustment_type = "PercentChangeInCapacity"
    cooldown = var.fargate_scaling_cooldown
    metric_aggregation_type = "Average"
    min_adjustment_magnitude = 1
    step_adjustment {
      scaling_adjustment          = var.fargate_downscale_adjustment
      metric_interval_upper_bound = 0
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "scale_up" {
  count = var.use_fargate ? 1 : 0
  alarm_name                = "${local.full_name}-queueThreshold-scale-up"
  comparison_operator       = "GreaterThanOrEqualToThreshold"
  evaluation_periods        = 1
  metric_name               = "ActivityScheduleTime"
  namespace                 = "AWS/States"
  period                    = var.fargate_scaling_adjustment_period
  statistic                 = "Average"
  threshold                 = var.fargate_scheduled_task_threshold * 1000
  alarm_description         = "This metric monitors a fargate task activity for activity schedule time increases"
  alarm_actions             = [aws_appautoscaling_policy.ecs_policy_fargate_up[0].arn]
  dimensions                = {
    ActivityArn = var.environment.ACTIVITY_ARN
  }
}


resource "aws_cloudwatch_metric_alarm" "scale_down" {
  count = var.use_fargate ? 1 : 0
  alarm_name                = "${local.full_name}-queueThreshold-scale-down"
  comparison_operator       = "LessThanThreshold"
  evaluation_periods        = 1
  metric_name               = "ActivityScheduleTime"
  namespace                 = "AWS/States"
  period                    = var.fargate_scaling_adjustment_period
  statistic                 = "Average"
  threshold                 = var.fargate_scheduled_task_threshold * 1000
  alarm_description         = "This metric monitors a fargate task activity for a reduction in queued activities"
  alarm_actions             = [aws_appautoscaling_policy.ecs_policy_fargate_down[0].arn]
  dimensions                = {
    ActivityArn = var.environment.ACTIVITY_ARN
  }
}

resource "aws_appautoscaling_policy" "ecs_policy_fargate_off" {
  count = var.use_fargate ? 1 : 0
  name               = "${local.full_name}-fg-downscale"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.fargate_ecs_service_target[0].resource_id
  scalable_dimension = aws_appautoscaling_target.fargate_ecs_service_target[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.fargate_ecs_service_target[0].service_namespace

  step_scaling_policy_configuration {
    adjustment_type = "PercentChangeInCapacity"
    cooldown = var.fargate_scaling_cooldown
    metric_aggregation_type = "Average"
    min_adjustment_magnitude = 1
    step_adjustment {
      scaling_adjustment          = var.fargate_downscale_adjustment
      metric_interval_upper_bound = 0
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "service_off" {
  count = var.use_fargate ? 1 : 0
  alarm_name                = "${local.full_name}-queueThreshold-scale-down"
  comparison_operator       = "LessThanThreshold"
  evaluation_periods        = 1
  metric_name               = "ActivitiesScheduled"
  namespace                 = "AWS/States"
  period                    = var.fargate_scaling_adjustment_period
  statistic                 = "Sum"
  threshold                 = 1
  alarm_description         = "This alarm monitors if *any* requests have come in for the service"
  alarm_actions             = [aws_appautoscaling_policy.ecs_policy_fargate_off[0].arn]
  dimensions                = {
    ActivityArn = var.environment.ACTIVITY_ARN
  }
}

