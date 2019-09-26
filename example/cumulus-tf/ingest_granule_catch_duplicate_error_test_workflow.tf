module "ingest_granule_catch_duplicate_error_test_workflow" {
  source = "../../tf-modules/workflow"

  prefix                                = var.prefix
  name                                  = "IngestGranuleCatchDuplicateErrorTest"
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
    "downloadBucket": "{{$.cumulus_meta.system_bucket}}",
    "duplicateHandling": "{{$.meta.collection.duplicateHandling}}",
    "pdr": "{{$.meta.pdr}}",
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
  "ChooseProcess": {},
  "ProcessingStep": {
    "bucket": "{{$.meta.buckets.internal.name}}",
    "collection": "{{$.meta.collection}}",
    "cumulus_message": {
      "outputs": [
        {
          "source": "{{$.files}}",
          "destination": "{{$.payload}}"
        }
      ]
    }
  },
  "FilesToGranulesStep": {
    "inputGranules": "{{$.meta.input_granules}}",
    "granuleIdExtraction": "{{$.meta.collection.granuleIdExtraction}}"
  },
  "MoveGranuleStep": {
    "bucket": "{{$.meta.buckets.internal.name}}",
    "buckets": "{{$.meta.buckets}}",
    "distribution_endpoint": "{{$.meta.distribution_endpoint}}",
    "collection": "{{$.meta.collection}}",
    "duplicateHandling": "{{$.meta.collection.duplicateHandling}}"
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
  "WorkflowFailed": {},
  "WorkflowSucceeded": {}
}
JSON

  state_machine_definition = <<JSON
{
  "Comment": "Ingest Granule Catch Duplicate Error",
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
            "States.ALL"
          ],
          "IntervalSeconds": 2,
          "MaxAttempts": 3
        }
      ],
      "Catch": [
        {
          "ErrorEquals": [
            "DuplicateFile"
          ],
          "ResultPath": "$.meta.syncGranCaughtError",
          "Next": "WorkflowSucceeded"
        },
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "ResultPath": "$.exception",
          "Next": "StopStatus"
        }
      ],
      "Next": "ChooseProcess"
    },
    "ChooseProcess": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.cumulus_meta.process",
          "StringEquals": "modis",
          "Next": "ProcessingStep"
        }
      ],
      "Default": "StopStatus"
    },
    "ProcessingStep": {
      "Type": "Task",
      "Resource": "${module.cumulus.fake_processing_task_lambda_function_arn}",
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "ResultPath": "$.exception",
          "Next": "StopStatus"
        }
      ],
      "Retry": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "IntervalSeconds": 2,
          "MaxAttempts": 3
        }
      ],
      "Next": "FilesToGranulesStep"
    },
    "FilesToGranulesStep": {
      "Type": "Task",
      "Resource": "${module.cumulus.files_to_granules_task_lambda_function_arn}",
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
          "ResultPath": "$.exception",
          "Next": "StopStatus"
        }
      ],
      "Next": "MoveGranuleStep"
    },
    "MoveGranuleStep": {
      "Type": "Task",
      "Resource": "${module.cumulus.move_granules_task_lambda_function_arn}",
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
          "ResultPath": "$.meta.moveGranCaughtError",
          "Next": "WorkflowSucceeded"
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
    },
    "WorkflowSucceeded": {
      "Type": "Succeed"
    }
  }
}
JSON
}
