locals {
  api_env_variables = {
    "OAUTH_PROVIDER"       = var.oauth_provider
    "api_config_secret_id" = var.api_config_secret_arn
    "AWS_ACCOUNT_ID"       = var.aws_account_id
    "ICEBERG_NAMESPACE"    = var.iceberg_namespace
    "ECS_TASK_MEMORY"      = tostring(var.iceberg_api_memory)
    "ECS_TASK_CPU"         = tostring(var.iceberg_api_cpu)
  }
}

data "aws_ecr_repository" "cumulus_iceberg_api" {
  name = "cumulus-iceberg-api"
}

data "aws_ssm_parameter" "private_ca" {
  name = "ngap_private_ca_arn"
}

resource "aws_cloudwatch_log_group" "iceberg_api" {
  name              = "/ecs/${var.prefix}-iceberg-api"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "IcebergApi", var.default_log_retention_days)
}

resource "aws_ecs_task_definition" "iceberg_api" {
  family                   = "${var.prefix}-IcebergApiTask"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.iceberg_api_cpu
  memory                   = var.iceberg_api_memory
  execution_role_arn       = var.ecs_execution_role_arn
  task_role_arn            = aws_iam_role.iceberg_task_role.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name      = "iceberg-api-container"
      image     = "${data.aws_ecr_repository.cumulus_iceberg_api.repository_url}:${var.cumulus_iceberg_api_image_version}"
      essential = true
      portMappings = [
        {
          containerPort = 5001
          hostPort      = 5001
        }
      ]
      environment = [
        for k, v in merge(local.api_env_variables, { "auth_mode" = "public" }) : {
          name  = k
          value = tostring(v)
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.iceberg_api.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "iceberg_api" {
  name                              = "${var.prefix}-IcebergApiService"
  cluster                           = var.ecs_cluster_arn
  task_definition                   = aws_ecs_task_definition.iceberg_api.arn
  desired_count                     = var.api_service_autoscaling_min_capacity
  health_check_grace_period_seconds = 180
  launch_type                       = "FARGATE"

  network_configuration {
    subnets = var.ecs_cluster_instance_subnet_ids

    # Include RDS security group to allow database access
    security_groups  = [aws_security_group.iceberg_ecs_task_sg.id, var.rds_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.iceberg_api.arn
    container_name   = "iceberg-api-container" # Must match name in task definition
    container_port   = 5001
  }

  # Ensure the service doesn't start until the ALB listener is ready
  depends_on = [aws_lb_listener.iceberg_services_https]

  # Allow autoscaling to manage desired_count
  lifecycle {
    ignore_changes = [desired_count]
  }
}

resource "aws_lb" "iceberg_api" {
  name               = "${var.prefix}-iceberg-api"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.iceberg_alb_sg.id]
  subnets            = var.ecs_cluster_instance_subnet_ids
}

resource "aws_lb_target_group" "iceberg_api" {
  name_prefix          = substr("${var.prefix}-", 0, 6)
  port                 = 5001
  protocol             = "HTTP"
  vpc_id               = var.vpc_id
  target_type          = "ip"
  deregistration_delay = 120

  health_check {
    path                = "/version"
    matcher             = "200-399" # Accept any success or redirect code
    interval            = 20
    timeout             = 10
    unhealthy_threshold = 6
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "iceberg_lb_cert" {
  domain_name               = "${var.prefix}.cumulus.earthdatacloud.nasa.gov"
  certificate_authority_arn = data.aws_ssm_parameter.private_ca.value

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener" "iceberg_services_https" {
  load_balancer_arn = aws_lb.iceberg_api.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.iceberg_lb_cert.arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.iceberg_api.arn
  }

  # This ensures the listener is updated/removed BEFORE the group
  depends_on = [aws_lb_target_group.iceberg_api]
}

resource "aws_security_group" "iceberg_alb_sg" {
  name        = "${var.prefix}-iceberg-alb-sg"
  description = "Controls access to the ALB"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "iceberg_ecs_task_sg" {
  name        = "${var.prefix}-iceberg-ecs-task-sg"
  description = "Allows access only from the ALB"
  vpc_id      = var.vpc_id

  # Standard egress: Allow container to pull images and reach the DB
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group_rule" "iceberg_alb_to_ecs" {
  type                     = "ingress"
  from_port                = 5001
  to_port                  = 5001
  protocol                 = "tcp"
  security_group_id        = aws_security_group.iceberg_ecs_task_sg.id
  source_security_group_id = aws_security_group.iceberg_alb_sg.id
}

# ECS Service Autoscaling
resource "aws_appautoscaling_target" "iceberg_api" {
  max_capacity       = var.api_service_autoscaling_max_capacity
  min_capacity       = var.api_service_autoscaling_min_capacity
  resource_id        = "service/${var.ecs_cluster_name}/${aws_ecs_service.iceberg_api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "iceberg_api_cpu" {
  name               = "${var.prefix}-iceberg-api-cpu-autoscaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.iceberg_api.resource_id
  scalable_dimension = aws_appautoscaling_target.iceberg_api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.iceberg_api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = var.api_service_autoscaling_target_cpu
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
