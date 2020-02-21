module "discover_granules_browse_example_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "DiscoverGranulesBrowseExample"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = <<JSON
{
  "Comment": "Example for Browse Generation Data Cookbook",
  "StartAt": "DiscoverGranules",
  "TimeoutSeconds": 18000,
  "States": {
    "DiscoverGranules": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "provider": "{$.meta.provider}",
            "collection": "{$.meta.collection}",
            "buckets": "{$.meta.buckets}",
            "stack": "{$.meta.stack}"
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.discover_granules_task.task_arn}",
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
      "Next": "QueueGranules"
    },
    "QueueGranules": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "provider": "{$.meta.provider}",
            "internalBucket": "{$.meta.buckets.internal.name}",
            "stackName": "{$.meta.stack}",
            "granuleIngestMessageTemplateUri": "{$.meta.template}",
            "granuleIngestWorkflow": "CookbookBrowseExample",
            "queueUrl": "{$.meta.queues.startSF}"
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.queue_granules_task.task_arn}",
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

module "cookbook_browse_example_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "CookbookBrowseExample"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = <<JSON
{
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
            "States.ALL"
          ],
          "ResultPath": "$.exception",
          "Next": "WorkflowFailed"
        }
      ],
      "Next": "ProcessingStep"
    },
    "ProcessingStep": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "bucket": "{$.meta.buckets.internal.name}",
            "collection": "{$.meta.collection}",
            "cmrMetadataFormat": "{$.meta.cmrMetadataFormat}",
            "additionalUrls": "{$.meta.additionalUrls}",
            "generateFakeBrowse": true,
            "cumulus_message": {
              "outputs": [
                {
                  "source": "{$.granules}",
                  "destination": "{$.meta.input_granules}"
                },
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
            "States.ALL"
          ],
          "ResultPath": "$.exception",
          "Next": "WorkflowFailed"
        }
      ],
      "Next": "CmrStep"
    },
    "CmrStep": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "bucket": "{$.meta.buckets.internal.name}",
            "stack": "{$.meta.stack}",
            "cmr": "{$.meta.cmr}",
            "launchpad": "{$.meta.launchpad}",
            "input_granules": "{$.meta.input_granules}",
            "granuleIdExtraction": "{$.meta.collection.granuleIdExtraction}"
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.post_to_cmr_task.task_arn}",
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
