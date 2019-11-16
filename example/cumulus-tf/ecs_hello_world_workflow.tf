resource "aws_sfn_activity" "ecs_task_hello_world" {
  name = "${var.prefix}-EcsTaskHelloWorld"
  tags = local.default_tags
}

module "hello_world_service" {
  source = "../../tf-modules/cumulus_ecs_service"

  prefix = var.prefix
  name   = "HelloWorld"
  tags   = local.default_tags

  cluster_arn                           = module.cumulus.ecs_cluster_arn
  desired_count                         = 1
  image                                 = "cumuluss/cumulus-ecs-task:1.3.0"
  log2elasticsearch_lambda_function_arn = module.cumulus.log2elasticsearch_lambda_function_arn

  cpu                = 400
  memory_reservation = 700

  environment = {
    AWS_DEFAULT_REGION = data.aws_region.current.name
  }
  command = [
    "cumulus-ecs-task",
    "--activityArn",
    aws_sfn_activity.ecs_task_hello_world.id,
    "--lambdaArn",
    module.cumulus.hello_world_task.task_arn
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

module "ecs_hello_world_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "EcsHelloWorldWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.default_tags

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
