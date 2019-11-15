module "ingest_granule_catch_duplicate_error_test_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "IngestGranuleCatchDuplicateErrorTest"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.default_tags

  state_machine_definition = <<JSON
{
  "Comment": "Ingest Granule Catch Duplicate Error",
  "StartAt": "SyncGranule",
  "States": {
    "SyncGranule": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "ReplaceConfig": {
            "Path": "$.payload",
            "TargetPath": "$.payload"
          },
          "task_config": {
            "buckets": "{$.meta.buckets}",
            "provider": "{$.meta.provider}",
            "collection": "{$.meta.collection}",
            "stack": "{$.meta.stack}",
            "downloadBucket": "{$.cumulus_meta.system_bucket}",
            "duplicateHandling": "{$.meta.collection.duplicateHandling}",
            "pdr": "{$.meta.pdr}",
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
                  "destination": "{$.meta.process}"
                }
              ]
            }
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.sync_granule_task.task_arn}",
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
          "Next": "WorkflowFailed"
        }
      ],
      "Next": "ChooseProcess"
    },
    "ChooseProcess": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.meta.process",
          "StringEquals": "modis",
          "Next": "ProcessingStep"
        }
      ],
      "Default": "WorkflowSucceeded"
    },
    "ProcessingStep": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "bucket": "{$.meta.buckets.internal.name}",
            "collection": "{$.meta.collection}",
            "cumulus_message": {
              "outputs": [
                {
                  "source": "{$.files}",
                  "destination": "{$.payload}"
                }
              ]
            }
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.fake_processing_task.task_arn}",
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "ResultPath": "$.exception",
          "Next": "WorkflowFailed"
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
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "inputGranules": "{$.meta.input_granules}",
            "granuleIdExtraction": "{$.meta.collection.granuleIdExtraction}"
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.files_to_granules_task.task_arn}",
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
          "Next": "WorkflowFailed"
        }
      ],
      "Next": "MoveGranuleStep"
    },
    "MoveGranuleStep": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "bucket": "{$.meta.buckets.internal.name}",
            "buckets": "{$.meta.buckets}",
            "distribution_endpoint": "{$.meta.distribution_endpoint}",
            "collection": "{$.meta.collection}",
            "duplicateHandling": "{$.meta.collection.duplicateHandling}"
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.move_granules_task.task_arn}",
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
          "Next": "WorkflowFailed"
        }
      ],
      "Next": "WorkflowSucceeded"
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
