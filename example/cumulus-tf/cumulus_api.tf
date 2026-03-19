locals {
  api_env_variables  = {
        "OAUTH_PROVIDER": var.oauth_provider
        "api_config_secret_id": module.cumulus.api_config_secret_arn
        "RUN_API_AS_SERVER": tostring(var.run_api_as_server)
  }
}

data "aws_ecr_repository" "cumulus_search_api" {
  name = "cumulus-search-api"
}

data "aws_ssm_parameter" "private_ca" {
  name = "ngap_private_ca_arn"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.prefix}-iceberg-api"
  retention_in_days = 30
}

# 1. Define the Task Definition (The "What" to run)
resource "aws_ecs_task_definition" "api" {
  family                   = "${var.prefix}-ApiTask"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512    # Roughly equivalent to your memory choice
  memory                   = 1024   # Matches your ~1280MB logic
  execution_role_arn       = module.cumulus.ecs_execution_role_arn
  task_role_arn            = module.cumulus.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name      = "iceberg-api-container"
      image     = "${data.aws_ecr_repository.cumulus_search_api.repository_url}:${var.cumulus_search_api_image_version}"
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
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

# 2. Define the ECS Service (The "How many" to run)
resource "aws_ecs_service" "api" {
  name            = "${var.prefix}-IcebergApiService"
  cluster         = module.cumulus.ecs_cluster_arn
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 1
  health_check_grace_period_seconds = 180
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = length(var.ecs_cluster_instance_subnet_ids) == 0 ? local.subnet_ids : var.ecs_cluster_instance_subnet_ids

    # Include RDS security group to allow database access
    security_groups  = [aws_security_group.ecs_task_sg.id, local.rds_security_group]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "iceberg-api-container" # Must match name in task definition
    container_port   = 5001
  }

  # Ensure the service doesn't start until the ALB listener is ready
  depends_on = [aws_lb_listener.services_https]
}

# 1. The Load Balancer itself
resource "aws_lb" "api" {
  name               = "${var.prefix}-iceberg-api-alb"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_sg.id]
  subnets            = length(var.ecs_cluster_instance_subnet_ids) == 0 ? local.subnet_ids : var.ecs_cluster_instance_subnet_ids
}

# 2. Target Group (The "Address Book" for your containers)
resource "aws_lb_target_group" "api" {
  name_prefix = "yl-api"
  port        = 5001
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip" # Required for Fargate
  deregistration_delay = 120

  health_check {
    path                = "/version" # Ensure your Node.js app has this route! Changed from /health
    matcher = "200-399" # Accept any success or redirect code
    interval            = 20
    timeout             = 10
    unhealthy_threshold = 6
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "lb_cert" {
  domain_name       = "${var.prefix}.cumulus.earthdatacloud.nasa.gov"
  certificate_authority_arn = data.aws_ssm_parameter.private_ca.value

  lifecycle {
    create_before_destroy = true
  }
}

################ https listener and listener rules
resource "aws_lb_listener" "services_https" {
  load_balancer_arn = aws_lb.api.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.lb_cert.arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  # This ensures the listener is updated/removed BEFORE the group
  depends_on = [aws_lb_target_group.api]
}

# 1. ALB Security Group (The "Front Door")
resource "aws_security_group" "alb_sg" {
  name        = "${var.prefix}-alb-sg"
  description = "Controls access to the ALB"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Standard egress: Allow the ALB to talk to the world (and your ECS tasks)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# 2. ECS Task Security Group (The "Inner Sanctum")
resource "aws_security_group" "ecs_task_sg" {
  name        = "${var.prefix}-ecs-task-sg"
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

# 3. The "Stitch" Rule: Bridge the ALB to the ECS Task
resource "aws_security_group_rule" "alb_to_ecs" {
  type                     = "ingress"
  from_port                = 5001
  to_port                  = 5001
  protocol                 = "tcp"
  security_group_id        = aws_security_group.ecs_task_sg.id
  source_security_group_id = aws_security_group.alb_sg.id
}
