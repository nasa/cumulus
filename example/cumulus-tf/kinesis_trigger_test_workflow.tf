module "kinesis_trigger_test_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "KinesisTriggerTest"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = <<JSON
{
  "Comment": "Tests Workflow from Kinesis Stream",
  "StartAt": "TranslateMessage",
  "States": {
    "TranslateMessage": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "collection": "{$.meta.collection}",
            "cumulus_message": {
              "outputs": [
                {
                  "source": "{$.cnm}",
                  "destination": "{$.meta.cnm}"
                },
                {
                  "source": "{$.output}",
                  "destination": "{$.payload}"
                }
              ]
            }
          }
        }
      },
      "Type": "Task",
      "Resource": "${aws_lambda_function.cnm_to_cma_task.arn}",
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
          "Next": "TranslateMessageResponseFail"
        }
      ],
      "Next": "SyncGranule"
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
            "provider": "{$.meta.provider}",
            "buckets": "{$.meta.buckets}",
            "collection": "{$.meta.collection}",
            "downloadBucket": "{$.meta.buckets.private.name}",
            "stack": "{$.meta.stack}",
            "cumulus_message": {
              "outputs": [
                {
                  "source": "{$.granules}",
                  "destination": "{$.meta.input_granules}"
                },
                {
                  "source": "{$}",
                  "destination": "{$.payload}"
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
          "IntervalSeconds": 10,
          "MaxAttempts": 3
        }
      ],
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "ResultPath": "$.exception",
          "Next": "CnmResponseFail"
        }
      ],
      "Next": "CnmResponse"
    },
    "CnmResponse": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "OriginalCNM": "{$.meta.cnm}",
            "response-endpoint": "{$.meta.cnmResponseStream}",
            "region": "us-east-1",
            "type": "kinesis",
            "WorkflowException": "{$.exception}",
            "cumulus_message": {
              "outputs": [
                {
                  "source": "{$}",
                  "destination": "{$.meta.cnmResponse}"
                },
                {
                  "source": "{$.cnm}",
                  "destination": "{$.payload}"
                }
              ]
            }
          }
        }
      },
      "Type": "Task",
      "Resource": "${aws_lambda_function.cnm_response_task.arn}",
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
      "Next": "WorkflowSucceeded"
    },
    "TranslateMessageResponseFail": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "OriginalCNM": "{$.payload}",
            "response-endpoint": "{$.meta.cnmResponseStream}",
            "region": "us-east-1",
            "type": "kinesis",
            "WorkflowException": "{$.exception}",
            "cumulus_message": {
              "outputs": [
                {
                  "source": "{$}",
                  "destination": "{$.meta.cnmResponse}"
                },
                {
                  "source": "{$}",
                  "destination": "{$.payload}"
                }
              ]
            }
          }
        }
      },
      "Type": "Task",
      "Resource": "${aws_lambda_function.cnm_response_task.arn}",
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
      "Next": "WorkflowFailed"
    },
    "CnmResponseFail": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "OriginalCNM": "{$.meta.cnm}",
            "response-endpoint": "{$.meta.cnmResponseStream}",
            "region": "us-east-1",
            "type": "kinesis",
            "WorkflowException": "{$.exception}",
            "cumulus_message": {
              "outputs": [
                {
                  "source": "{$}",
                  "destination": "{$.meta.cnmResponse}"
                },
                {
                  "source": "{$}",
                  "destination": "{$.payload}"
                }
              ]
            }
          }
        }
      },
      "Type": "Task",
      "Resource": "${aws_lambda_function.cnm_response_task.arn}",
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
      "Next": "WorkflowFailed"
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
