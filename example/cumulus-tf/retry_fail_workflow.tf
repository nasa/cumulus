module "retry_fail_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "RetryFailWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.default_tags

  state_machine_definition = <<JSON
{
  "Comment": "Tests Retries and Fail",
  "StartAt": "HelloWorld",
  "States": {
    "HelloWorld": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "fail": true
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.hello_world_task.task_arn}",
      "Retry": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "IntervalSeconds": 2,
          "BackoffRate": 2,
          "MaxAttempts": 3
        }
      ],
      "End": true
    }
  }
}
JSON
}
