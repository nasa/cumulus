resource "aws_sfn_activity" "ecs_task_hello_world" {
  name = "${var.prefix}-EcsTaskHelloWorld"
  tags = local.default_tags
}

module "hello_world_service" {
  source = "../../tf-modules/cumulus_ecs_service"

  prefix = var.prefix
  name   = "HelloWorld"
  tags   = local.default_tags

  activity_arn                          = aws_sfn_activity.ecs_task_hello_world.id
  cluster_arn                           = module.cumulus.ecs_cluster_arn
  desired_count                         = 1
  image                                 = "cumuluss/cumulus-ecs-task:1.3.0"
  log2elasticsearch_lambda_function_arn = module.cumulus.log2elasticsearch_lambda_function_arn
  scaling_role_arn                      = module.cumulus.scaling_role_arn

  cpu                = 400
  memory_reservation = 700

  min_capacity = 1
  max_capacity = 10

  environment = {
    AWS_DEFAULT_REGION = data.aws_region.current.name
  }
  command = [
    "cumulus-ecs-task",
    "--activityArn",
    aws_sfn_activity.ecs_task_hello_world.id,
    "--lambdaArn",
    module.cumulus.hello_world_task_lambda_function_arn
  ]
  alarms = {
    TaskCountHight = {
      comparison_operator = "GreaterThanThreshold"
      evaluation_periods  = 1
      metric_name         = "MemoryUtilization"
      statistic           = "SampleCount"
      threshold           = 1
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "ecs_hello_world_task_count_high" {
  alarm_description   = "There are more tasks running than the desired"
  alarm_name          = "${var.prefix}-EcsTaskHelloWorld-TaskCountHighAlarm"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "MemoryUtilization"
  statistic           = "SampleCount"
  threshold           = 1
  period              = 60
  namespace           = "AWS/ECS"
  dimensions = {
    ClusterName = module.cumulus.ecs_cluster_name
    ServiceName = module.hello_world_service.service_name
  }
  tags = local.default_tags
}

module "ecs_hello_world_workflow" {
  source = "../../tf-modules/workflow"

  prefix                                = var.prefix
  name                                  = "EcsHelloWorldWorkflow"
  distribution_url                      = module.cumulus.distribution_url
  state_machine_role_arn                = module.cumulus.step_role_arn
  sf_semaphore_down_lambda_function_arn = module.cumulus.sf_semaphore_down_lambda_function_arn
  publish_reports_lambda_function_arn   = module.cumulus.publish_reports_lambda_function_arn
  system_bucket                         = var.system_bucket
  tags                                  = local.default_tags

  state_machine_definition = <<JSON
{
  "Comment": "Returns Hello World",
  "StartAt": "EcsTaskHelloWorld",
  "States": {
    "EcsTaskHelloWorld": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "buckets": "{$.meta.buckets}",
            "provider": "{$.meta.provider}",
            "collection": "{$.meta.collection}"
          }
        }
      },
      "Type": "Task",
      "Resource": "${aws_sfn_activity.ecs_task_hello_world.id}",
      "TimeoutSeconds": 60,
      "Retry": [
        {
          "ErrorEquals": [
            "States.Timeout"
          ],
          "MaxAttempts": 1
        }
      ],
      "End": true
    }
  }
}
JSON
}
