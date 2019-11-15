module "retry_pass_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "RetryPassWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.default_tags

  state_machine_definition = <<JSON
{
  "Comment": "Tests Retry Configurations",
  "StartAt": "HelloWorld",
  "States": {
    "HelloWorld": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "fail": true,
            "passOnRetry": true,
            "bucket": "{$.meta.buckets.internal.name}",
            "execution": "{$.cumulus_meta.execution_name}"
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
          "MaxAttempts": 3
        }
      ],
      "End": true
    }
  }
}
JSON
}
