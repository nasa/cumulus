module "kinesis_trigger_test_workflow" {
  source = "../../tf-modules/workflow"

  prefix                                = var.prefix
  name                                  = "KinesisTriggerTest"
  distribution_url                      = module.cumulus.distribution_url
  state_machine_role_arn                = module.cumulus.step_role_arn
  sf_semaphore_down_lambda_function_arn = module.cumulus.sf_semaphore_down_lambda_function_arn
  sftracker_sns_topic_arn               = module.cumulus.sftracker_sns_topic_arn
  system_bucket                         = var.system_bucket
  tags                                  = local.default_tags

  workflow_config = <<JSON
{
  "StartStatus": {
    "cumulus_message": {
      "input": "{{$}}"
    }
  },
  "TranslateMessage": {
    "cumulus_message": {
      "outputs": [
        {
          "source": "{{$.cnm}}",
          "destination": "{{$.meta.cnm}}"
        },
        {
          "source": "{{$}}",
          "destination": "{{$.payload}}"
        }
      ]
    }
  },
  "SyncGranule": {
    "provider": "{{$.meta.provider}}",
    "buckets": "{{$.meta.buckets}}",
    "collection": "{{$.meta.collection}}",
    "downloadBucket": "{{$.meta.buckets.private.name}}",
    "stack": "{{$.meta.stack}}",
    "cumulus_message": {
      "outputs": [
        {
          "source": "{{$.granules}}",
          "destination": "{{$.meta.input_granules}}"
        },
        {
          "source": "{{$}}",
          "destination": "{{$.payload}}"
        }
      ]
    }
  },
  "CnmResponse": {
    "OriginalCNM": "{{$.meta.cnm}}",
    "CNMResponseStream": "{{$.meta.cnmResponseStream}}",
    "region": "us-east-1",
    "WorkflowException": "{{$.exception}}",
    "cumulus_message": {
      "outputs": [
        {
          "source": "{{$}}",
          "destination": "{{$.meta.cnmResponse}}"
        },
        {
          "source": "{{$}}",
          "destination": "{{$.payload}}"
        }
      ]
    }
  },
  "CnmResponseFail": {
    "OriginalCNM": "{{$.meta.cnm}}",
    "CNMResponseStream": "{{$.meta.cnmResponseStream}}",
    "region": "us-east-1",
    "WorkflowException": "{{$.exception}}",
    "cumulus_message": {
      "outputs": [
        {
          "source": "{{$}}",
          "destination": "{{$.meta.cnmResponse}}"
        },
        {
          "source": "{{$}}",
          "destination": "{{$.payload}}"
        }
      ]
    }
  },
  "StopStatus": {},
  "StopStatusFail": {},
  "WorkflowSucceeded": {},
  "WorkflowFailed": {}
}
JSON

  state_machine_definition = <<JSON
{
  "Comment": "Tests Workflow from Kinesis Stream",
  "StartAt": "StartStatus",
  "States": {
    "StartStatus": {
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
          "Next": "CnmResponseFail"
        }
      ],
      "Next": "TranslateMessage"
    },
    "TranslateMessage": {
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
          "Next": "CnmResponseFail"
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
          "Next": "StopStatus"
        }
      ],
      "Next": "StopStatus"
    },
    "CnmResponseFail": {
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
          "Next": "StopStatusFail"
        }
      ],
      "Next": "StopStatusFail"
    },
    "StopStatus": {
      "Type": "Task",
      "Resource": "${module.cumulus.sf2snsEnd_lambda_function_arn}",
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
      "Next": "WorkflowSucceeded"
    },
    "StopStatusFail": {
      "Type": "Task",
      "Resource": "${module.cumulus.sf2snsEnd_lambda_function_arn}",
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
      "Next": "WorkflowFailed",
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "Next": "WorkflowFailed"
        }
      ]
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
