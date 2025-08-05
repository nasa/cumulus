resource "aws_iam_role" "ecs_cluster_instance" {
  name = "${var.prefix}_ecs_cluster_instance_role"
  assume_role_policy   = data.aws_iam_policy_document.ec2_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn

  tags = var.tags
}

data "aws_iam_policy_document" "ecs_cluster_instance_policy" {
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
      "kinesis:describeStream",
      "kinesis:ListShards",
      "kinesis:getShardIterator",
      "kinesis:GetRecords"
    ]
    resources = ["arn:aws:kinesis:*:*:*"]
  }

  statement {
    actions = [
      "sqs:Send*",
      "sqs:GetQueueUrl",
    ]
    resources = ["arn:aws:sqs:*:*:*"]
  }

  statement {
    actions = [
      "states:DescribeActivity",
      "states:DescribeExecution",
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
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:Scan",
      "dynamodb:Query"
    ]
    resources = [for k, v in var.dynamo_tables : v.arn]
  }

  statement {
    actions   = ["dynamodb:Query"]
    resources = [for k, v in var.dynamo_tables : "${v.arn}/index/*"]
  }

  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      module.archive.cmr_password_secret_arn,
      module.archive.launchpad_passphrase_secret_arn,
    ]
  }
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      var.rds_user_access_secret_arn
    ]
  }

  statement {
    actions   = ["sns:Publish"]
    resources = [
      module.archive.report_executions_sns_topic_arn,
      module.archive.report_pdrs_sns_topic_arn,
      module.archive.report_granules_sns_topic_arn,
    ]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [module.archive.provider_kms_key_arn]
  }
}

resource "aws_iam_role_policy" "ecs_cluster_instance" {
  name   = "${var.prefix}_ecs_cluster_instance_policy"
  role   = aws_iam_role.ecs_cluster_instance.id
  policy = data.aws_iam_policy_document.ecs_cluster_instance_policy.json
}

resource "aws_iam_role_policy_attachment" "NGAPProtAppInstanceMinimalPolicy" {
  count = var.deploy_to_ngap ? 1 : 0
  policy_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/NGAPProtAppInstanceMinimalPolicy"
  role = aws_iam_role.ecs_cluster_instance.id
}

resource "aws_iam_instance_profile" "ecs_cluster_instance" {
  name = "${var.prefix}_ecs_cluster_profile"
  role = aws_iam_role.ecs_cluster_instance.id
}

resource "aws_security_group" "ecs_cluster_instance" {
  vpc_id = var.vpc_id
  tags   = var.tags
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
  tags   = var.tags
}

resource "aws_ecs_cluster" "default" {
  name = "${var.prefix}-CumulusECSCluster"
  tags = var.tags
}

data "aws_efs_mount_target" "ecs_cluster_instance" {
  count           = var.ecs_efs_config == null ? 0 : 1
  mount_target_id = var.ecs_efs_config.mount_target_id
}

locals {
  ecs_instance_autoscaling_user_data_config = {
    cluster_name              = aws_ecs_cluster.default.name
    container_stop_timeout    = var.ecs_container_stop_timeout,
    docker_hub_config         = var.ecs_docker_hub_config,
    docker_volume_create_size = var.ecs_cluster_instance_docker_volume_size - 1,
    efs_dns_name              = var.ecs_efs_config == null ? null : data.aws_efs_mount_target.ecs_cluster_instance[0].dns_name,
    efs_mount_point           = var.ecs_efs_config == null ? null : var.ecs_efs_config.mount_point,
    include_docker_cleanup_cronjob = var.ecs_include_docker_cleanup_cronjob,
    region                    = data.aws_region.current.name
    task_reaper_object        = aws_s3_bucket_object.task_reaper
  }

  security_group_ids = compact(concat(
    [
      aws_security_group.ecs_cluster_instance.id,
      var.rds_security_group
    ],
    var.ecs_custom_sg_ids
  ))
}

resource "aws_launch_template" "ecs_cluster_instance" {
  name_prefix   = "${var.prefix}_ecs_cluster_template"
  key_name      = var.key_name
  image_id      = var.ecs_cluster_instance_image_id
  instance_type = var.ecs_cluster_instance_type
  vpc_security_group_ids = local.security_group_ids
  block_device_mappings {
    device_name = "/dev/xvdcz"
    ebs {
      delete_on_termination = true
      encrypted             = true
      volume_size           = var.ecs_cluster_instance_docker_volume_size
    }
  }

  iam_instance_profile {
    arn = aws_iam_instance_profile.ecs_cluster_instance.arn
  }
  metadata_options {
    http_tokens = "required"
  }
  monitoring {
    enabled = true
  }

  user_data = base64encode(templatefile(
    "${path.module}/ecs_cluster_instance_autoscaling_user_data.tmpl",
    local.ecs_instance_autoscaling_user_data_config
  ))
}

resource "aws_autoscaling_group" "ecs_cluster_instance" {
  name_prefix         = aws_ecs_cluster.default.name
  desired_capacity    = var.ecs_cluster_desired_size
  max_size            = var.ecs_cluster_max_size
  min_size            = var.ecs_cluster_min_size
  vpc_zone_identifier = var.ecs_cluster_instance_subnet_ids

  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 50
    }
  }
  launch_template {
    id      = aws_launch_template.ecs_cluster_instance.id
    version = aws_launch_template.ecs_cluster_instance.latest_version
  }
  lifecycle {
    create_before_destroy = true
  }

  tag {
    key                 = "Name"
    value               = aws_ecs_cluster.default.name
    propagate_at_launch = true
  }

  dynamic "tag" {
    for_each = var.tags
    content {
      key                 = tag.key
      propagate_at_launch = true
      value               = tag.value
    }
  }
}

resource "aws_autoscaling_lifecycle_hook" "ecs_instance_termination_hook" {
  name                   = "${aws_ecs_cluster.default.name}-ecs-termination-hook"
  autoscaling_group_name = aws_autoscaling_group.ecs_cluster_instance.name
  default_result         = "CONTINUE"
  heartbeat_timeout      = 150
  lifecycle_transition   = "autoscaling:EC2_INSTANCE_TERMINATING"
}

# Scale in config

resource "aws_autoscaling_policy" "ecs_instance_autoscaling_group_scale_in" {
  name                    = "${aws_autoscaling_group.ecs_cluster_instance.name}-scale-in"
  autoscaling_group_name  = aws_autoscaling_group.ecs_cluster_instance.name
  adjustment_type         = "PercentChangeInCapacity"
  metric_aggregation_type = "Average"
  policy_type             = "StepScaling"

  step_adjustment {
    metric_interval_upper_bound = 0
    scaling_adjustment          = var.ecs_cluster_scale_in_adjustment_percent
  }
}

resource "aws_cloudwatch_metric_alarm" "ecs_instance_autoscaling_group_cpu_scale_in_alarm" {
  alarm_name          = "${aws_autoscaling_group.ecs_cluster_instance.name}-cpu-scale-in"
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
  tags                = var.tags
}

# Scale out config

resource "aws_autoscaling_policy" "ecs_instance_autoscaling_group_scale_out" {
  name                    = "${aws_autoscaling_group.ecs_cluster_instance.name}-scale-out"
  autoscaling_group_name  = aws_autoscaling_group.ecs_cluster_instance.name
  adjustment_type         = "PercentChangeInCapacity"
  metric_aggregation_type = "Average"
  policy_type             = "StepScaling"
  min_adjustment_magnitude = 1

  step_adjustment {
    metric_interval_lower_bound = 0
    scaling_adjustment          = var.ecs_cluster_scale_out_adjustment_percent
  }
}

resource "aws_cloudwatch_metric_alarm" "ecs_instance_autoscaling_group_cpu_scale_out_alarm" {
  alarm_name          = "${aws_autoscaling_group.ecs_cluster_instance.name}-cpu-scale-out"
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
  tags                = var.tags
}
