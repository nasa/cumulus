module "parse_pdr_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "ParsePdr"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.default_tags

  state_machine_definition = <<JSON
{
  "Comment": "Parse a given PDR",
  "StartAt": "ParsePdr",
  "States": {
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
      "Resource": "${module.cumulus.parse_pdr_task.task_arn}",
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
      "Next": "CheckStatus"
    },
    "CheckStatus": {
      "Type": "Task",
      "Resource": "${module.cumulus.pdr_status_check_task.task_arn}",
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
          "Next": "WorkflowFailed"
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
          "Next": "WorkflowSucceeded"
        }
      ],
      "Default": "WorkflowSucceeded"
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
      "Resource": "${module.cumulus.sf_sns_report_task.task_arn}",
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
      "Next": "WaitForSomeTime"
    },
    "WaitForSomeTime": {
      "Type": "Wait",
      "Seconds": 10,
      "Next": "CheckStatus"
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
