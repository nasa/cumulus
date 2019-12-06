resource "aws_iam_role" "ecs_cluster_instance" {
  assume_role_policy   = data.aws_iam_policy_document.ec2_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
  # TODO Re-enable once IAM permissions have been fixed
  # tags                 = local.default_tags
}

data "aws_iam_policy_document" "ecs_cluster_instance_policy" {
  statement {
    actions   = ["dynamodb:UpdateItem"]
    resources = [var.dynamo_tables.async_operations.arn]
  }

  statement {
    actions = [
      "autoscaling:CompleteLifecycleAction",
      "autoscaling:DescribeAutoScalingInstances",
      "autoscaling:DescribeLifecycleHooks",
      "autoscaling:RecordLifecycleActionHeartbeat",
      "cloudwatch:GetMetricStatistics",
      "ec2:DescribeInstances",
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetAuthorizationToken",
      "ecr:GetDownloadUrlForLayer",
      "ecs:DeregisterContainerInstance",
      "ecs:DescribeClusters",
      "ecs:DescribeContainerInstances",
      "ecs:DescribeServices",
      "ecs:DiscoverPollEndpoint",
      "ecs:ListContainerInstances",
      "ecs:ListServices",
      "ecs:ListTaskDefinitions",
      "ecs:ListTasks",
      "ecs:Poll",
      "ecs:RegisterContainerInstance",
      "ecs:RunTask",
      "ecs:StartTelemetrySession",
      "ecs:Submit*",
      "ecs:UpdateContainerInstancesState",
      "lambda:GetFunction",
      "lambda:GetLayerVersion",
      "lambda:invokeFunction",
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
      "ssm:GetParameter"
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "kinesis:ListShards",
      "kinesis:getShardIterator",
      "kinesis:GetRecords"
    ]
    resources = ["arn:aws:kinesis:*:*:*"]
  }

  statement {
    actions = [
      "sqs:Send*"
    ]
    resources = ["arn:aws:sqs:*:*:*"]
  }

  statement {
    actions = [
      "states:DescribeActivity",
      "states:GetActivityTask",
      "states:GetExecutionHistory",
      "states:SendTaskFailure",
      "states:SendTaskSuccess"
    ]
    resources = ["arn:aws:states:*:*:*"]
  }

  statement {
    actions = [
      "s3:GetAccelerateConfiguration",
      "s3:GetBucket*",
      "s3:GetLifecycleConfiguration",
      "s3:GetReplicationConfiguration",
      "s3:ListBucket*",
      "s3:PutAccelerateConfiguration",
      "s3:PutBucket*",
      "s3:PutLifecycleConfiguration",
      "s3:PutReplicationConfiguration"
    ]
    resources = [for b in local.all_bucket_names : "arn:aws:s3:::${b}"]
  }

  statement {
    actions = [
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:GetObject*",
      "s3:ListMultipartUploadParts",
      "s3:PutObject*"
    ]
    resources = [for b in local.all_bucket_names : "arn:aws:s3:::${b}/*"]
  }

  statement {
    actions   = [
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
      "dynamodb:Scan"
    ]
    resources = [for k, v in var.dynamo_tables : v.arn]
  }

  statement {
    actions = [
      "es:ESHttpDelete",
      "es:ESHttpGet",
      "es:ESHttpHead",
      "es:ESHttpPost",
      "es:ESHttpPut"
    ]
    resources = [var.elasticsearch_domain_arn]
  }
}

resource "aws_iam_role_policy" "ecs_cluster_instance" {
  role   = aws_iam_role.ecs_cluster_instance.id
  policy = data.aws_iam_policy_document.ecs_cluster_instance_policy.json
}

resource "aws_iam_instance_profile" "ecs_cluster_instance" {
  name = "${var.prefix}-ecs"
  role = aws_iam_role.ecs_cluster_instance.id
}

resource "aws_security_group" "ecs_cluster_instance" {
  vpc_id = var.vpc_id
  tags   = local.default_tags
}

resource "aws_security_group_rule" "ecs_cluster_instance_allow_ssh" {
  type              = "ingress"
  from_port         = 2
  to_port           = 2
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.ecs_cluster_instance.id
}

resource "aws_security_group_rule" "ecs_cluster_instance_allow_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.ecs_cluster_instance.id
}

resource "aws_s3_bucket_object" "task_reaper" {
  bucket = var.system_bucket
  key    = "${var.prefix}/task-reaper.sh"
  source = "${path.module}/task-reaper.sh"
  etag   = filemd5("${path.module}/task-reaper.sh")
  tags   = local.default_tags
}

resource "aws_ecs_cluster" "default" {
  name = "${var.prefix}-CumulusECSCluster"
  tags = local.default_tags
}

data "aws_efs_mount_target" "ecs_cluster_instance" {
  count           = var.ecs_efs_config == null ? 0 : 1
  mount_target_id = var.ecs_efs_config.mount_target_id
}

locals {
  ecs_instance_autoscaling_cf_template_config = {
    cluster_name              = aws_ecs_cluster.default.name
    container_stop_timeout    = var.ecs_container_stop_timeout,
    docker_hub_config         = var.ecs_docker_hub_config,
    docker_storage_driver     = var.ecs_docker_storage_driver,
    docker_volume_size        = var.ecs_cluster_instance_docker_volume_size,
    docker_volume_create_size = var.ecs_cluster_instance_docker_volume_size - 1,
    efs_dns_name              = var.ecs_efs_config == null ? null : data.aws_efs_mount_target.ecs_cluster_instance[0].dns_name,
    efs_mount_point           = var.ecs_efs_config == null ? null : var.ecs_efs_config.mount_point,
    image_id                  = var.ecs_cluster_instance_image_id,
    instance_profile          = aws_iam_instance_profile.ecs_cluster_instance.arn,
    instance_type             = var.ecs_cluster_instance_type,
    key_name                  = var.key_name,
    min_size                  = var.ecs_cluster_min_size,
    desired_capacity          = var.ecs_cluster_desired_size,
    max_size                  = var.ecs_cluster_max_size,
    region                    = data.aws_region.current.name
    security_group_id         = aws_security_group.ecs_cluster_instance.id,
    subnet_ids                = var.ecs_cluster_instance_subnet_ids,
    task_reaper_object        = aws_s3_bucket_object.task_reaper
  }
}

resource "aws_cloudformation_stack" "ecs_instance_autoscaling_group" {
  name          = "${aws_ecs_cluster.default.name}-autoscaling-group"
  template_body = templatefile("${path.module}/ecs_cluster_instance_autoscaling_cf_template.yml.tmpl", local.ecs_instance_autoscaling_cf_template_config)
  tags          = local.default_tags
}

resource "aws_autoscaling_lifecycle_hook" "ecs_instance_termination_hook" {
  name                   = "${aws_ecs_cluster.default.name}-ecs-termination-hook"
  autoscaling_group_name = aws_cloudformation_stack.ecs_instance_autoscaling_group.outputs.AutoscalingGroupName
  default_result         = "CONTINUE"
  heartbeat_timeout      = 150
  lifecycle_transition   = "autoscaling:EC2_INSTANCE_TERMINATING"
}

# Scale in config

resource "aws_autoscaling_policy" "ecs_instance_autoscaling_group_scale_in" {
  name                    = "${aws_cloudformation_stack.ecs_instance_autoscaling_group.outputs.AutoscalingGroupName}-scale-in"
  autoscaling_group_name  = aws_cloudformation_stack.ecs_instance_autoscaling_group.outputs.AutoscalingGroupName
  adjustment_type         = "PercentChangeInCapacity"
  metric_aggregation_type = "Average"
  policy_type             = "StepScaling"

  step_adjustment {
    metric_interval_upper_bound = 0
    scaling_adjustment          = var.ecs_cluster_scale_in_adjustment_percent
  }
}

resource "aws_cloudwatch_metric_alarm" "ecs_instance_autoscaling_group_memory_scale_in_alarm" {
  alarm_name          = "${aws_cloudformation_stack.ecs_instance_autoscaling_group.outputs.AutoscalingGroupName}-memory-scale-in"
  comparison_operator = "LessThanThreshold"
  alarm_actions       = [aws_autoscaling_policy.ecs_instance_autoscaling_group_scale_in.arn]
  datapoints_to_alarm = 1
  evaluation_periods  = 1
  metric_name         = "MemoryReservation"
  namespace           = "AWS/ECS"
  period              = 60
  statistic           = "Average"
  threshold           = var.ecs_cluster_scale_in_threshold_percent
  unit                = "Percent"
  dimensions          = { ClusterName = aws_ecs_cluster.default.name }
  tags                = local.default_tags
}

resource "aws_cloudwatch_metric_alarm" "ecs_instance_autoscaling_group_cpu_scale_in_alarm" {
  alarm_name          = "${aws_cloudformation_stack.ecs_instance_autoscaling_group.outputs.AutoscalingGroupName}-cpu-scale-in"
  comparison_operator = "LessThanThreshold"
  alarm_actions       = [aws_autoscaling_policy.ecs_instance_autoscaling_group_scale_in.arn]
  datapoints_to_alarm = 1
  evaluation_periods  = 1
  metric_name         = "CPUReservation"
  namespace           = "AWS/ECS"
  period              = 60
  statistic           = "Average"
  threshold           = var.ecs_cluster_scale_in_threshold_percent
  unit                = "Percent"
  dimensions          = { ClusterName = aws_ecs_cluster.default.name }
  tags                = local.default_tags
}

# Scale out config

resource "aws_autoscaling_policy" "ecs_instance_autoscaling_group_scale_out" {
  name                    = "${aws_cloudformation_stack.ecs_instance_autoscaling_group.outputs.AutoscalingGroupName}-scale-out"
  autoscaling_group_name  = aws_cloudformation_stack.ecs_instance_autoscaling_group.outputs.AutoscalingGroupName
  adjustment_type         = "PercentChangeInCapacity"
  metric_aggregation_type = "Average"
  policy_type             = "StepScaling"

  step_adjustment {
    metric_interval_upper_bound = 0
    scaling_adjustment          = var.ecs_cluster_scale_out_adjustment_percent
  }
}

resource "aws_cloudwatch_metric_alarm" "ecs_instance_autoscaling_group_memory_scale_out_alarm" {
  alarm_name          = "${aws_cloudformation_stack.ecs_instance_autoscaling_group.outputs.AutoscalingGroupName}-memory-scale-out"
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [aws_autoscaling_policy.ecs_instance_autoscaling_group_scale_out.arn]
  datapoints_to_alarm = 1
  evaluation_periods  = 1
  metric_name         = "MemoryReservation"
  namespace           = "AWS/ECS"
  period              = 60
  statistic           = "Average"
  threshold           = var.ecs_cluster_scale_out_threshold_percent
  unit                = "Percent"
  dimensions          = { ClusterName = aws_ecs_cluster.default.name }
  tags                = local.default_tags
}

resource "aws_cloudwatch_metric_alarm" "ecs_instance_autoscaling_group_cpu_scale_out_alarm" {
  alarm_name          = "${aws_cloudformation_stack.ecs_instance_autoscaling_group.outputs.AutoscalingGroupName}-cpu-scale-out"
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [aws_autoscaling_policy.ecs_instance_autoscaling_group_scale_out.arn]
  datapoints_to_alarm = 1
  evaluation_periods  = 1
  metric_name         = "CPUReservation"
  namespace           = "AWS/ECS"
  period              = 60
  statistic           = "Average"
  threshold           = var.ecs_cluster_scale_out_threshold_percent
  unit                = "Percent"
  dimensions          = { ClusterName = aws_ecs_cluster.default.name }
  tags                = local.default_tags
}
