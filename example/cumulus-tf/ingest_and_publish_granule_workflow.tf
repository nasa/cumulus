module "ingest_and_publish_granule_workflow" {
  source = "../../tf-modules/workflow"

  prefix                                = var.prefix
  name                                  = "IngestAndPublishGranule"
  distribution_url                      = module.cumulus.distribution_url
  state_machine_role_arn                = module.cumulus.step_role_arn
  sf_semaphore_down_lambda_function_arn = module.cumulus.sf_semaphore_down_lambda_function_arn
  sftracker_sns_topic_arn               = module.cumulus.sftracker_sns_topic_arn
  system_bucket                         = var.system_bucket
  tags                                  = local.default_tags

  state_machine_definition = <<JSON
{
  "Comment": "Ingest Granule",
  "StartAt": "Report",
  "States": {
    "Report": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "ReplaceConfig": {
            "FullMessage": true
          },
          "task_config": {
            "cumulus_message": {
              "input": "{$}"
            }
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.sf_sns_report_task_lambda_function_arn}",
      "Next": "SyncGranule",
      "ResultPath": null,
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
      "Next": "ChooseProcess",
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "Next": "StopStatus",
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
          "Variable": "$.cumulus_meta.process"
        }
      ],
      "Default": "StopStatus",
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
      "Resource": "${module.cumulus.fake_processing_task_lambda_function_arn}",
      "Next": "FilesToGranulesStep",
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "Next": "StopStatus",
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
      "Resource": "${module.cumulus.files_to_granules_task_lambda_function_arn}",
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "Next": "StopStatus",
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
      "Resource": "${module.cumulus.move_granules_task_lambda_function_arn}",
      "Next": "CmrStep",
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "Next": "StopStatus",
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
            "process": "{$.cumulus_meta.process}"
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.post_to_cmr_task_lambda_function_arn}",
      "Next": "StopStatus",
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "Next": "StopStatus",
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
    "StopStatus": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "ReplaceConfig": {
            "FullMessage": true
          },
          "task_config": {
            "sfnEnd": true,
            "stack": "{$.meta.stack}",
            "bucket": "{$.meta.buckets.internal.name}",
            "stateMachine": "{$.cumulus_meta.state_machine}",
            "executionName": "{$.cumulus_meta.execution_name}",
            "cumulus_message": {
              "input": "{$}"
            }
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.sf_sns_report_task_lambda_function_arn}",
      "End": true,
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "Next": "WorkflowFailed"
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
    "WorkflowFailed": {
      "Cause": "Workflow failed",
      "Type": "Fail"
    }
  }
}
JSON
}
