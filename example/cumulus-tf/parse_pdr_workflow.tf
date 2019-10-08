module "parse_pdr_workflow" {
  source = "../../tf-modules/workflow"

  prefix                                = var.prefix
  name                                  = "ParsePdr"
  distribution_url                      = module.cumulus.distribution_url
  state_machine_role_arn                = module.cumulus.step_role_arn
  sf_semaphore_down_lambda_function_arn = module.cumulus.sf_semaphore_down_lambda_function_arn
  system_bucket                         = var.system_bucket
  tags                                  = local.default_tags

  state_machine_definition = <<JSON
{
  "Comment": "Parse a given PDR",
  "StartAt": "StatusReport",
  "States": {
    "StatusReport": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "cumulus_message": {
              "input": "{$}"
            }
          }
        }
      },
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
      "Next": "ParsePdr"
    },
    "ParsePdr": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "ReplaceConfig": {
            "FullMessage": true
          },
          "task_config": {
            "provider": "{$.meta.provider}",
            "bucket": "{$.meta.buckets.internal.name}",
            "stack": "{$.meta.stack}"
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.parse_pdr_task_lambda_function_arn}",
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
      "Next": "QueueGranules"
    },
    "QueueGranules": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "ReplaceConfig": {
            "FullMessage": true
          },
          "task_config": {
            "provider": "{$.meta.provider}",
            "internalBucket": "{$.meta.buckets.internal.name}",
            "stackName": "{$.meta.stack}",
            "granuleIngestWorkflow": "${module.ingest_granule_workflow.name}",
            "queueUrl": "{$.meta.queues.startSF}"
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.queue_granules_task_lambda_function_arn}",
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
      "Next": "CheckStatus"
    },
    "CheckStatus": {
      "Type": "Task",
      "Resource": "${module.cumulus.pdr_status_check_task_lambda_function_arn}",
      "Parameters": {
        "cma": {
          "event.$": "$",
          "ReplaceConfig": {
            "Path": "$.payload",
            "TargetPath": "$.payload"
          },
          "task_config": {
            "cumulus_message": {
              "outputs": [
                {
                  "source": "{$}",
                  "destination": "{$.payload}"
                },
                {
                  "source": "{$.isFinished}",
                  "destination": "{$.meta.isPdrFinished}"
                }
              ]
            }
          }
        }
      },
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
      "Next": "CheckAgainChoice"
    },
    "CheckAgainChoice": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.meta.isPdrFinished",
          "BooleanEquals": false,
          "Next": "PdrStatusReport"
        },
        {
          "Variable": "$.meta.isPdrFinished",
          "BooleanEquals": true,
          "Next": "StopStatus"
        }
      ],
      "Default": "StopStatus"
    },
    "PdrStatusReport": {
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
      "ResultPath": null,
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
          "ResultPath": "$.exception",
          "Next": "StopStatus"
        }
      ],
      "Next": "WaitForSomeTime"
    },
    "WaitForSomeTime": {
      "Type": "Wait",
      "Seconds": 10,
      "Next": "CheckStatus"
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
