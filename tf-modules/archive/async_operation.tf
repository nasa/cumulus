resource "aws_cloudwatch_log_group" "async_operation" {
  name = "${var.prefix}-AsyncOperationEcsLogs"
  retention_in_days = 30
  tags = local.default_tags
}

resource "aws_ecs_task_definition" "async_operation" {
  family                = "${var.prefix}-AsyncOperationTaskDefinition"
  tags                  = local.default_tags
  container_definitions = <<EOS
[
  {
    "name": "AsyncOperation",
    "cpu": 400,
    "essential": true,
    "environment": [
      {
        "name": "AWS_REGION",
        "value": "${data.aws_region.current.name}"
      }
    ],
    "image": "cumuluss/async-operation:26",
    "memoryReservation": 700,
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "${aws_cloudwatch_log_group.async_operation.name}",
        "awslogs-region": "${data.aws_region.current.name}"
      }
    }
  }
]
EOS
}

resource "aws_cloudwatch_log_subscription_filter" "async_operation_ecs_log" {
  name            = "${var.prefix}-AsyncOperationEcsLogSubscription"
  destination_arn = aws_lambda_function.log2elasticsearch.arn
  log_group_name  = aws_cloudwatch_log_group.async_operation.name
  filter_pattern  = ""
  distribution    = "ByLogStream"
}
