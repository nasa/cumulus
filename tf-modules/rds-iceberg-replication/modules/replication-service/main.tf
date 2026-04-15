terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.100, < 6.0.0"
    }
  }
}

locals {
  full_name = "${var.prefix}-${var.slot_name}-replication"
}

data "aws_subnet" "selected" {
  id = var.subnet
}

# Pre-provision the EBS volume — this persists independently of the task
resource "aws_ebs_volume" "kafka_data" {
  availability_zone = data.aws_subnet.selected.availability_zone
  size              = var.volume_size_in_gb
  type              = "gp3"
  encrypted         = true
  tags              = merge(var.tags, { Name = "${local.full_name}-kafka-data" })

  lifecycle {
    prevent_destroy = true  # Safety net — don't accidentally nuke the Kafka data
  }
}

resource "aws_ecs_service" "kafka-replication" {
  name                               = local.full_name
  cluster                            = var.ecs_cluster.id
  desired_count                      = 1
  task_definition                    = aws_ecs_task_definition.default.arn
  deployment_maximum_percent         = 100
  deployment_minimum_healthy_percent = 0
  force_new_deployment               = var.force_new_deployment
  launch_type                        = "FARGATE"
  depends_on                         = [var.ecs_infrastructure_role]

  network_configuration {
    subnets = [var.subnet] # Pin to one subnet/AZ for EBS consistency
    security_groups  = [var.rds_security_group, var.task_security_group_id]
    assign_public_ip = false # Fargate tasks in private subnets usually don't need public IPs
  }

  volume_configuration {
    name = "kafka-data"
    managed_ebs_volume {
      encrypted   = true
      size_in_gb  = var.volume_size_in_gb
      volume_type = "gp3"
      role_arn    = var.ecs_infrastructure_role.arn
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
  execution_role_arn       = var.ecs_task_execution_role.arn
  task_role_arn            = var.fargate_task_role.arn

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
        {name = "KAFKA_ADVERTISED_LISTENERS", value = "INTERNAL://localhost:9092,EXTERNAL://localhost:9093"},
        {name = "KAFKA_LISTENER_SECURITY_PROTOCOL_MAP", value = "INTERNAL:PLAINTEXT,EXTERNAL:PLAINTEXT,CONTROLLER:PLAINTEXT"},
        {name = "KAFKA_INTER_BROKER_LISTENER_NAME", value = "INTERNAL"}
      ]
      image             = var.kafka_image
      logConfiguration  = {
        logDriver = "awslogs"
        options = {
          awslogs-group  = aws_cloudwatch_log_group.kafka-logs.name
          awslogs-region = var.region
          awslogs-stream-prefix = "${var.prefix}-${var.slot_name}-kafka"
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
        {name = "CONFIG_STORAGE_TOPIC", value = "connect_configs"},
        {name = "OFFSET_STORAGE_TOPIC", value = "connect_offsets"},
        {name = "STATUS_STORAGE_TOPIC", value = "connect_statuses"},
        {name = "BOOTSTRAP_SERVERS", value = "localhost:9092"},
        {name = "RDS_ENDPOINT", value = var.rds_endpoint}
      ]
      image             = var.connect_image
      logConfiguration  = {
        logDriver = "awslogs"
        options = {
          awslogs-group  = aws_cloudwatch_log_group.kafka-connect-logs.name
          awslogs-region = var.region
          awslogs-stream-prefix = "${var.prefix}-${var.slot_name}-kafka-connect"
        }
      }
    },
    {
      name              = "${var.prefix}-bootstrap"
      essential         = true
      mountPoints       = [{
        sourceVolume    = "kafka-data"
        containerPath   = "/kafka/data"
        readOnly        = false
      }]
      environment       = [
        {name = "PG_HOST", value = var.rds_endpoint},
        {name = "PG_PORT", value = var.rds_port},
        {name = "PG_DB", value = var.pg_db},
        {name = "PG_USER", value = var.db_admin_username},
        {name = "PG_PASSWORD", value = var.db_admin_password},
        {name = "TABLES", value = var.table_include_list},
        {name = "AWS_DEFAULT_REGION", value = var.region},
        {name = "ICEBERG_NAMESPACE", value = var.iceberg_namespace},
        {name = "ICEBERG_S3_BUCKET", value = var.iceberg_s3_bucket},
        {name = "SLOT_NAME", value = var.slot_name}
      ]
      image             = var.bootstrap_image
      logConfiguration  = {
        logDriver = "awslogs"
        options = {
          awslogs-group  = aws_cloudwatch_log_group.bootstrap-logs.name
          awslogs-region = var.region
          awslogs-stream-prefix = "${var.prefix}-${var.slot_name}-bootstrap"
        }
      }
    }
  ])

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "kafka-logs" {
  name              = "/aws/ecs/cluster/${local.full_name}/kafka"
  retention_in_days = 1
}

resource "aws_cloudwatch_log_group" "kafka-connect-logs" {
  name              = "/aws/ecs/cluster/${local.full_name}/kafka-connect"
  retention_in_days = 1
}

resource "aws_cloudwatch_log_group" "bootstrap-logs" {
  name              = "/aws/ecs/cluster/${local.full_name}/bootstrap"
  retention_in_days = 1
}
