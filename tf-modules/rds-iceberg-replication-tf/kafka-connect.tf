resource "aws_ecs_service" "kafka" {
  name                               = local.full_name
  cluster                            = aws_ecs_cluster.default.id
  desired_count                      = 1
  task_definition                    = aws_ecs_task_definition.default.arn
  deployment_maximum_percent         = 100
  deployment_minimum_healthy_percent = 0
  force_new_deployment               = var.force_new_deployment
  depends_on                         = [aws_iam_role.ecs_infrastructure_role]

  network_configuration {
    subnets          = aws_db_subnet_group.default.subnet_ids
    security_groups  = [var.security_group_name]
    assign_public_ip = false # Fargate tasks in private subnets usually don't need public IPs
  }

  volume_configuration {
    name = "kafka-data"
    managed_ebs_volume {
      encrypted   = true
      size_in_gb  = var.volume_size_in_gb
      volume_type = "gp3"
      role_arn    = aws_iam_role.ecs_infrastructure_role.arn
    }
  }
  wait_for_steady_state = true
}

resource "aws_ecs_task_definition" "default" {
  family                   = local.full_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  runtime_platform {
    cpu_architecture       = var.cpu_architecture
  }
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.fargate_task_role.arn

  volume {
    name = "kafka-data"
    configure_at_launch = true # Required for Fargate
  }

  container_definitions    = jsonencode([
    {
      name              = "${var.prefix}-kafka"
      essential         = true
      mountPoints       = [{
        sourceVolume    = "kafka-data"
        containerPath   = "/kafka/data"
        readOnly        = false
      }]
      environment       = [
        {name = "CLUSTER_ID", value = "kafka"},
        {name = "NODE_ROLE", value = "combined"},
        {name = "KAFKA_LISTENERS", value = "INTERNAL://0.0.0.0:9092,EXTERNAL://0.0.0.0:9093,CONTROLLER://0.0.0.0:9094"},
        {name = "KAFKA_ADVERTISED_LISTENERS", value = "INTERNAL://kafka:9092,EXTERNAL://localhost:9093"},
        {name = "KAFKA_LISTENER_SECURITY_PROTOCOL_MAP", value = "INTERNAL:PLAINTEXT,EXTERNAL:PLAINTEXT,CONTROLLER:PLAINTEXT"},
        {name = "KAFKA_INTER_BROKER_LISTENER_NAME", value = "INTERNAL"}
      ]
      image             = var.kafka_image
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group  = aws_cloudwatch_log_group.kafka-logs.name
          awslogs-region = var.region
          awslogs-stream-prefix = "${var.prefix}-kafka"
        }
      }
    },
    {
      name              = "${var.prefix}-kafka-connect"
      essential         = true
      mountPoints       = [{
        sourceVolume    = "kafka-data"
        containerPath   = "/kafka/data"
        readOnly        = false
      }]
      environment       = [
        {name = "GROUP_ID", value = "1"},
        {name = "CONFIG_STORAGE_TOPIC", value = "my_connect_configs"},
        {name = "OFFSET_STORAGE_TOPIC", value = "my_connect_offsets"},
        {name = "STATUS_STORAGE_TOPIC", value = "my_connect_statuses"},
        {name = "BOOTSTRAP_SERVERS", value = "localhost:9092"},
        {name = "RDS_ENDPOINT", value = var.rds_endpoint}
      ]
      image             = var.connect_image
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group  = aws_cloudwatch_log_group.kafka-connect-logs.name
          awslogs-region = var.region
          awslogs-stream-prefix = "${var.prefix}-kafka-connect"
        }
      }
    }
  ])

  tags = var.tags
}