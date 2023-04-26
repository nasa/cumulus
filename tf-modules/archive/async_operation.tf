resource "aws_cloudwatch_log_group" "async_operation" {
  name = "${var.prefix}-AsyncOperationEcsLogs"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "AsyncOperationEcsLogs", var.default_log_retention_days)
  tags = var.tags
}
resource "aws_ecs_task_definition" "async_operation" {
  depends_on               = [aws_cloudwatch_log_group.async_operation]
  family                   = "${var.prefix}-AsyncOperationTaskDefinition"
  tags                     = var.tags
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  execution_role_arn       = var.ecs_execution_role.arn
  task_role_arn            = var.ecs_task_role.arn
  cpu                      = 256
  memory                   = 1024
  container_definitions    = <<EOS
[
  {
    "name": "AsyncOperation",
    "essential": true,
    "environment": [
      {
        "name": "AWS_REGION",
        "value": "${data.aws_region.current.name}"
      },
      {
        "name": "databaseCredentialSecretArn",
        "value": "${var.rds_user_access_secret_arn}"
      },
      {
        "name": "ES_HOST",
        "value": "${var.elasticsearch_hostname}"
      }
    ],
    "image": "${var.async_operation_image}",
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "${aws_cloudwatch_log_group.async_operation.name}",
        "awslogs-region": "${data.aws_region.current.name}",
        "awslogs-stream-prefix": "async-operation"
      }
    }
  }
]
EOS
}
