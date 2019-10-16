module "publish_granule_workflow" {
  source = "../../tf-modules/workflow"

  prefix                                = var.prefix
  name                                  = "PublishGranule"
  distribution_url                      = module.cumulus.distribution_url
  state_machine_role_arn                = module.cumulus.step_role_arn
  sf_semaphore_down_lambda_function_arn = module.cumulus.sf_semaphore_down_lambda_function_arn
  publish_reports_lambda_function_arn   = module.cumulus.publish_reports_lambda_function_arn
  system_bucket                         = var.system_bucket
  tags                                  = local.default_tags

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
      "Resource": "${module.cumulus.post_to_cmr_task_lambda_function_arn}",
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
