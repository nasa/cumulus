module "ingest_and_publish_granule_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "IngestAndPublishGranule"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.default_tags

  state_machine_definition = <<JSON
{
  "Comment": "Ingest Granule",
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
      "Next": "ChooseProcess",
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
          "ErrorEquals": [
            "States.ALL"
          ],
          "IntervalSeconds": 2,
          "MaxAttempts": 3
        }
      ]
    },
    "ChooseProcess": {
      "Choices": [
        {
          "Next": "ProcessingStep",
          "StringEquals": "modis",
          "Variable": "$.meta.process"
        }
      ],
      "Default": "WorkflowSucceeded",
      "Type": "Choice"
    },
    "ProcessingStep": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "ReplaceConfig": {
            "FullMessage": true
          },
          "task_config": {
            "bucket": "{$.meta.buckets.internal.name}",
            "collection": "{$.meta.collection}",
            "cmrMetadataFormat": "{$.meta.cmrMetadataFormat}",
            "additionalUrls": "{$.meta.additionalUrls}",
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
      "Next": "FilesToGranulesStep",
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
      ]
    },
    "FilesToGranulesStep": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "ReplaceConfig": {
            "FullMessage": true
          },
          "task_config": {
            "inputGranules": "{$.meta.input_granules}",
            "granuleIdExtraction": "{$.meta.collection.granuleIdExtraction}"
          }
        }
      },
      "Type": "Task",
      "Next": "MoveGranuleStep",
      "Resource": "${module.cumulus.files_to_granules_task.task_arn}",
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
      ]
    },
    "MoveGranuleStep": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "ReplaceConfig": {
            "FullMessage": true
          },
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
      "Next": "CmrStep",
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
      ]
    },
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
            "process": "{$.meta.process}"
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.post_to_cmr_task.task_arn}",
      "Next": "WorkflowSucceeded",
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
      ]
    },
    "WorkflowSucceeded": {
      "Type": "Succeed"
    },
    "WorkflowFailed": {
      "Cause": "Workflow failed",
      "Type": "Fail"
    }
  }
}
JSON
}
