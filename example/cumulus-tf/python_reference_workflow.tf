
resource "aws_sfn_activity" "ecs_task_python_processing_service" {
  name = "${var.prefix}-EcsTaskPythonProcess"
  tags = local.tags
}

module "python_processing_service" {
  source = "../../tf-modules/cumulus_ecs_service"

  prefix = var.prefix
  name   = "PythonProcess"
  tags   = local.tags

  cluster_arn                           = module.cumulus.ecs_cluster_arn
  desired_count                         = 1
  image                                 = "jlkovarik/cumulus-process-activity:test"
  log2elasticsearch_lambda_function_arn = module.cumulus.log2elasticsearch_lambda_function_arn

  cpu                = 400
  memory_reservation = 700

  environment = {
    AWS_DEFAULT_REGION = data.aws_region.current.name
    ACTIVITY_ARN = aws_sfn_activity.ecs_task_python_processing_service.id
  }
  command = [
    "/usr/local/bin/python",
    "process_activity.py"
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

module "python_reference_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "PythonReferenceWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = <<JSON
{
  "Comment": "Runs Python reference task and activity",
  "StartAt": "Reference Task",
  "States": {
    "Reference Task": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
              "configData": { "key1": "injectedData" }
          },
          "ReplaceConfig": {
            "MaxSize": 1,
            "Path": "$.payload",
            "TargetPath": "$.payload"
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.python_reference_task.task_arn}",
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException"
          ],
          "IntervalSeconds": 2,
          "MaxAttempts": 6,
          "BackoffRate": 2
        }
      ],
      "Next": "Process Task"
    },
    "Process Task": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "ReplaceConfig": {
            "MaxSize": 1,
            "Path": "$.payload",
            "TargetPath": "$.payload"
          }
        }
      },
      "Type": "Task",
      "Resource": "${aws_sfn_activity.ecs_task_python_processing_service.id}",
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
