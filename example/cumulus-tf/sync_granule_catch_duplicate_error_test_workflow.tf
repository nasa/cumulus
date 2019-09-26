module "sync_granule_catch_duplicate_error_test" {
  source = "../../tf-modules/workflow"

  prefix                                = var.prefix
  name                                  = "SyncGranuleCatchDuplicateErrorTest"
  distribution_url                      = module.cumulus.distribution_url
  state_machine_role_arn                = module.cumulus.step_role_arn
  sf_semaphore_down_lambda_function_arn = module.cumulus.sf_semaphore_down_lambda_function_arn
  sftracker_sns_topic_arn               = module.cumulus.sftracker_sns_topic_arn
  system_bucket                         = var.system_bucket
  tags                                  = local.default_tags

  workflow_config = <<JSON
{
  "Report": {
    "cumulus_message": {
      "input": "{{$}}"
    }
  },
  "SyncGranule": {
    "buckets": "{{$.meta.buckets}}",
    "provider": "{{$.meta.provider}}",
    "collection": "{{$.meta.collection}}",
    "stack": "{{$.meta.stack}}",
    "fileStagingDir": "custom-staging-dir",
    "downloadBucket": "{{$.cumulus_meta.system_bucket}}",
    "duplicateHandling": "{{$.meta.collection.duplicateHandling}}",
    "cumulus_message": {
      "outputs": [
        {
          "source": "{{$.granules}}",
          "destination": "{{$.meta.input_granules}}"
        },
        {
          "source": "{{$}}",
          "destination": "{{$.payload}}"
        },
        {
          "source": "{{$.process}}",
          "destination": "{{$.cumulus_meta.process}}"
        }
      ]
    }
  },
  "StopStatus": {
    "sfnEnd": true,
    "stack": "{{$.meta.stack}}",
    "bucket": "{{$.meta.buckets.internal.name}}",
    "stateMachine": "{{$.cumulus_meta.state_machine}}",
    "executionName": "{{$.cumulus_meta.execution_name}}",
    "cumulus_message": {
      "input": "{{$}}"
    }
  },
  "WorkflowFailed": {}
}
JSON

  state_machine_definition = <<JSON
{
  "Comment": "Catch DuplicateError for SyncGranule",
  "StartAt": "Report",
  "States": {
    "Report": {
      "Type": "Task",
      "Resource": "${module.cumulus.sf_sns_report_task_lambda_function_arn}",
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
      "Next": "SyncGranule"
    },
    "SyncGranule": {
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
          "Next": "StopStatus"
        },
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "ResultPath": "$.exception",
          "Next": "StopStatus"
        }
      ],
      "Next": "StopStatus"
    },
    "StopStatus": {
      "Type": "Task",
      "Resource": "${module.cumulus.sf_sns_report_task_lambda_function_arn}",
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
            "States.ALL"
          ],
          "Next": "WorkflowFailed"
        }
      ],
      "End": true
    },
    "WorkflowFailed": {
      "Type": "Fail",
      "Cause": "Workflow failed"
    }
  }
}
JSON
}
