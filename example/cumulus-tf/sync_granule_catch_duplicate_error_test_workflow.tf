module "sync_granule_catch_duplicate_error_test" {
  source = "../../tf-modules/workflow"

  prefix                                = var.prefix
  name                                  = "SyncGranuleCatchDuplicateErrorTest"
  distribution_url                      = module.cumulus.distribution_url
  state_machine_role_arn                = module.cumulus.step_role_arn
  sf_semaphore_down_lambda_function_arn = module.cumulus.sf_semaphore_down_lambda_function_arn
  publish_reports_lambda_function_arn   = module.cumulus.publish_reports_lambda_function_arn
  system_bucket                         = var.system_bucket
  tags                                  = local.default_tags

  state_machine_definition = <<JSON
{
  "Comment": "Catch DuplicateError for SyncGranule",
  "StartAt": "SyncGranule",
  "States": {
    "SyncGranule": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "buckets": "{$.meta.buckets}",
            "provider": "{$.meta.provider}",
            "collection": "{$.meta.collection}",
            "stack": "{$.meta.stack}",
            "fileStagingDir": "custom-staging-dir",
            "downloadBucket": "{$.cumulus_meta.system_bucket}",
            "duplicateHandling": "{$.meta.collection.duplicateHandling}",
            "cumulus_message": {
              "input": "{$.payload}",
              "outputs": [
                {
                  "source": "{$.granules}",
                  "destination": "{$.meta.input_granules}"
                },
                {
                  "source": "{$}",
                  "destination": "{$.payload}"
                },
                {
                  "source": "{$.process}",
                  "destination": "{$.cumulus_meta.process}"
                }
              ]
            }
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.sync_granule_task_lambda_function_arn}",
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
      "Catch": [
        {
          "ErrorEquals": [
            "DuplicateFile"
          ],
          "ResultPath": "$.meta.caughtError",
          "Next": "WorkflowSucceeded"
        },
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "ResultPath": "$.exception",
          "Next": "WorkflowFailed"
        }
      ],
      "Next": "WorkflowSucceeded"
    },
    "WorkflowSucceeded": {
      "Type": "Succeed"
    },
    "WorkflowFailed": {
      "Type": "Fail",
      "Cause": "Workflow failed"
    }
  }
}
JSON
}
