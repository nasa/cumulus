locals {
  cluster_name = reverse(split("/", var.cluster_arn))[0]
  full_name    = "${var.prefix}-${var.name}"
}

data "aws_region" "current" {}

resource "aws_cloudwatch_log_group" "default" {
  name = "${local.full_name}EcsLogs"
  tags = var.tags
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

resource "aws_appautoscaling_target" "default" {
  count = var.enable_autoscaling ? 1 : 0

  min_capacity       = var.min_capacity
  max_capacity       = var.max_capacity
  resource_id        = "service/${local.cluster_name}/${aws_ecs_service.default.name}"
  role_arn           = var.scaling_role_arn
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "scale_in" {
  count = var.enable_autoscaling ? 1 : 0

  name               = "${local.full_name}-scale-in"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.default[0].resource_id
  scalable_dimension = aws_appautoscaling_target.default[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.default[0].service_namespace
  step_scaling_policy_configuration {
    cooldown                 = 60
    adjustment_type          = "PercentChangeInCapacity"
    min_adjustment_magnitude = 1
    step_adjustment {
      metric_interval_upper_bound = 0
      scaling_adjustment          = var.scale_in_adjustment_percent
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "scale_in" {
  count = var.enable_autoscaling ? 1 : 0

  alarm_name          = "${local.full_name}-scale-in"
  alarm_actions       = [aws_appautoscaling_policy.scale_in[0].arn]
  datapoints_to_alarm = 1
  evaluation_periods  = 1
  comparison_operator = "LessThanThreshold"
  threshold           = var.scale_in_activity_schedule_time
  treat_missing_data  = "missing"

  metric_query {
    id          = "e1"
    return_data = true
    expression  = "FILL(m1, 0)"
    label       = "NormalizedActivityScheduleTime"
  }

  metric_query {
    id          = "m1"
    return_data = false
    metric {
      namespace   = "AWS/States"
      metric_name = "ActivityScheduleTime"
      dimensions  = { ActivityArn = var.activity_arn }
      period      = 60
      stat        = "Average"
    }
  }
  tags = var.tags
}

resource "aws_appautoscaling_policy" "scale_out" {
  count = var.enable_autoscaling ? 1 : 0

  name               = "${local.full_name}-scale-out"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.default[0].resource_id
  scalable_dimension = aws_appautoscaling_target.default[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.default[0].service_namespace
  step_scaling_policy_configuration {
    cooldown                 = 60
    adjustment_type          = "PercentChangeInCapacity"
    min_adjustment_magnitude = 1
    step_adjustment {
      metric_interval_lower_bound = 0
      scaling_adjustment          = var.scale_out_adjustment_percent
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "scale_out" {
  count = var.enable_autoscaling ? 1 : 0

  alarm_name          = "${local.full_name}-scale-out"
  alarm_actions       = [aws_appautoscaling_policy.scale_out[0].arn]
  datapoints_to_alarm = 1
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = var.scale_out_activity_schedule_time
  treat_missing_data  = "missing"

  metric_query {
    id          = "e1"
    return_data = true
    expression  = "FILL(m1, 0)"
    label       = "NormalizedActivityScheduleTime"
  }

  metric_query {
    id          = "m1"
    return_data = false
    metric {
      namespace   = "AWS/States"
      metric_name = "ActivityScheduleTime"
      dimensions  = { ActivityArn = var.activity_arn }
      period      = 60
      stat        = "Average"
    }
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "task_count_low" {
  alarm_description   = "There are less tasks running than the desired"
  alarm_name          = "${local.full_name}-TaskCountLowAlarm"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "MemoryUtilization"
  statistic           = "SampleCount"
  threshold           = var.desired_count
  period              = 60
  namespace           = "AWS/ECS"
  dimensions = {
    ClusterName = local.cluster_name
    ServiceName = aws_ecs_service.default.name
  }
  tags = var.tags
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
