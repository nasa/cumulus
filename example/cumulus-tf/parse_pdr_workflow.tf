module "parse_pdr_workflow" {
  source = "../../tf-modules/workflow"

  prefix                                = var.prefix
  name                                  = "ParsePdr"
  distribution_url                      = module.cumulus.distribution_url
  state_machine_role_arn                = module.cumulus.step_role_arn
  sf_semaphore_down_lambda_function_arn = module.cumulus.sf_semaphore_down_lambda_function_arn
  sftracker_sns_topic_arn               = module.cumulus.sftracker_sns_topic_arn
  system_bucket                         = var.system_bucket
  tags                                  = local.default_tags

  workflow_config = <<JSON
{
  "StatusReport": {
    "cumulus_message": {
      "input": "{{$}}"
    }
  },
  "ParsePdr": {
    "provider": "{{$.meta.provider}}",
    "bucket": "{{$.meta.buckets.internal.name}}",
    "stack": "{{$.meta.stack}}"
  },
  "QueueGranules": {
    "provider": "{{$.meta.provider}}",
    "internalBucket": "{{$.meta.buckets.internal.name}}",
    "stackName": "{{$.meta.stack}}",
    "granuleIngestMessageTemplateUri": "{{$.meta.templates.IngestGranule}}",
    "queueUrl": "{{$.meta.queues.startSF}}"
  },
  "CheckStatus": {
    "cumulus_message": {
      "outputs": [
        {
          "source": "{{$}}",
          "destination": "{{$.payload}}"
        },
        {
          "source": "{{$.isFinished}}",
          "destination": "{{$.cumulus_meta.isPdrFinished}}"
        }
      ]
    }
  },
  "CheckAgainChoice": {},
  "PdrStatusReport": {
    "cumulus_message": {
      "input": "{{$}}"
    }
  },
  "WaitForSomeTime": {},
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
  "Comment": "Parse a given PDR",
  "StartAt": "StatusReport",
  "States": {
    "StatusReport": {
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
          "Variable": "$.cumulus_meta.isPdrFinished",
          "BooleanEquals": false,
          "Next": "PdrStatusReport"
        },
        {
          "Variable": "$.cumulus_meta.isPdrFinished",
          "BooleanEquals": true,
          "Next": "StopStatus"
        }
      ],
      "Default": "StopStatus"
    },
    "PdrStatusReport": {
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
