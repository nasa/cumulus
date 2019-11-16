module "publish_granule_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "PublishGranule"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.default_tags

  state_machine_definition = <<JSON
{
  "Comment": "Publish Granule",
  "StartAt": "CmrStep",
  "States": {
    "CmrStep": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "ReplaceConfig": {
            "FullMessage": true
          },
          "task_config": {
            "bucket": "{$.meta.buckets.internal.name}",
            "stack": "{$.meta.stack}",
            "cmr": "{$.meta.cmr}",
            "launchpad": "{$.meta.launchpad}",
            "process": "N/A"
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.post_to_cmr_task.task_arn}",
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "Next": "WorkflowFailed",
          "ResultPath": "$.exception"
        }
      ],
      "Retry": [
        {
          "BackoffRate": 2,
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException"
          ],
          "IntervalSeconds": 2,
          "MaxAttempts": 6
        }
      ],
      "End": true
    },
    "WorkflowFailed": {
      "Cause": "Workflow failed",
      "Type": "Fail"
    }
  }
}
JSON
}
