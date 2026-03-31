locals {
  api_env_variables  = {
        "OAUTH_PROVIDER" = var.oauth_provider
        "api_config_secret_id" = module.cumulus.api_config_secret_arn
        "DEPLOY_ICEBERG_API" = tostring(var.deploy_iceberg_api)
  }
}

resource "aws_ecr_repository" "cumulus_iceberg_api" {
  count = var.deploy_iceberg_api ? 1 : 0
  name  = "cumulus-iceberg-api"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.tags
}

data "aws_ssm_parameter" "private_ca" {
  count = var.deploy_iceberg_api ? 1 : 0
  name  = "ngap_private_ca_arn"
}

resource "aws_cloudwatch_log_group" "iceberg_api" {
  count             = var.deploy_iceberg_api ? 1 : 0
  name              = "/ecs/${var.prefix}-iceberg-api"
  retention_in_days = 30
}

resource "aws_ecs_task_definition" "iceberg_api" {
  count                    = var.deploy_iceberg_api ? 1 : 0
  family                   = "${var.prefix}-IcebergApiTask"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = module.cumulus.ecs_execution_role_arn
  task_role_arn            = module.cumulus.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name      = "iceberg-api-container"
      image     = "${aws_ecr_repository.cumulus_iceberg_api[0].repository_url}:${var.cumulus_iceberg_api_image_version}"
      essential = true
      portMappings = [
        {
          containerPort = 5001
          hostPort      = 5001
        }
      ]
      environment = [
        for k, v in merge(local.api_env_variables, {"auth_mode"="public"}) : {
          name  = k
          value = tostring(v)
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.iceberg_api[0].name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "iceberg_api" {
  count           = var.deploy_iceberg_api ? 1 : 0
  name            = "${var.prefix}-IcebergApiService"
  cluster         = module.cumulus.ecs_cluster_arn
  task_definition = aws_ecs_task_definition.iceberg_api[0].arn
  desired_count   = var.api_service_autoscaling_min_capacity
  health_check_grace_period_seconds = 180
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = length(var.ecs_cluster_instance_subnet_ids) == 0 ? local.subnet_ids : var.ecs_cluster_instance_subnet_ids

    # Include RDS security group to allow database access
    security_groups  = [aws_security_group.iceberg_ecs_task_sg[0].id, local.rds_security_group]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.iceberg_api[0].arn
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
  count              = var.deploy_iceberg_api ? 1 : 0
  name               = "${var.prefix}-iceberg-api-alb"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.iceberg_alb_sg[0].id]
  subnets            = length(var.ecs_cluster_instance_subnet_ids) == 0 ? local.subnet_ids : var.ecs_cluster_instance_subnet_ids
}

resource "aws_lb_target_group" "iceberg_api" {
  count       = var.deploy_iceberg_api ? 1 : 0
  name_prefix = substr("${var.prefix}-", 0, 6)
  port        = 5001
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"
  deregistration_delay = 120

  health_check {
    path                = "/version"
    matcher = "200-399" # Accept any success or redirect code
    interval            = 20
    timeout             = 10
    unhealthy_threshold = 6
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "iceberg_lb_cert" {
  count             = var.deploy_iceberg_api ? 1 : 0
  domain_name       = "${var.prefix}.cumulus.earthdatacloud.nasa.gov"
  certificate_authority_arn = data.aws_ssm_parameter.private_ca[0].value

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener" "iceberg_services_https" {
  count             = var.deploy_iceberg_api ? 1 : 0
  load_balancer_arn = aws_lb.iceberg_api[0].arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.iceberg_lb_cert[0].arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.iceberg_api[0].arn
  }

  # This ensures the listener is updated/removed BEFORE the group
  depends_on = [aws_lb_target_group.iceberg_api]
}

resource "aws_security_group" "iceberg_alb_sg" {
  count       = var.deploy_iceberg_api ? 1 : 0
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
  count       = var.deploy_iceberg_api ? 1 : 0
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
  count                    = var.deploy_iceberg_api ? 1 : 0
  type                     = "ingress"
  from_port                = 5001
  to_port                  = 5001
  protocol                 = "tcp"
  security_group_id        = aws_security_group.iceberg_ecs_task_sg[0].id
  source_security_group_id = aws_security_group.iceberg_alb_sg[0].id
}

# ECS Service Autoscaling
resource "aws_appautoscaling_target" "iceberg_api" {
  count              = var.deploy_iceberg_api ? 1 : 0
  max_capacity       = var.api_service_autoscaling_max_capacity
  min_capacity       = var.api_service_autoscaling_min_capacity
  resource_id        = "service/${module.cumulus.ecs_cluster_name}/${aws_ecs_service.iceberg_api[0].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "iceberg_api_cpu" {
  count              = var.deploy_iceberg_api ? 1 : 0
  name               = "${var.prefix}-iceberg-api-cpu-autoscaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.iceberg_api[0].resource_id
  scalable_dimension = aws_appautoscaling_target.iceberg_api[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.iceberg_api[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = var.api_service_autoscaling_target_cpu
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
