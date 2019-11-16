module "hello_world_fail_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "HelloWorldFailWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.default_tags

  state_machine_definition = <<JSON
{
  "Comment": "Failing Hello World Workflow",
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
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException"
          ],
          "IntervalSeconds": 2,
          "MaxAttempts": 6,
          "BackoffRate": 2
        }
      ],
      "End": true
    }
  }
}
JSON
}
