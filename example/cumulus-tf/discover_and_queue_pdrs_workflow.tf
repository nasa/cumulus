module "discover_and_queue_pdrs_workflow" {
  source = "../../tf-modules/workflow"

  prefix                                = var.prefix
  name                                  = "DiscoverAndQueuePdrs"
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
  "DiscoverPdrs": {
    "stack": "{{$.meta.stack}}",
    "provider": "{{$.meta.provider}}",
    "bucket": "{{$.meta.buckets.internal.name}}",
    "collection": "{{$.meta.collection}}"
  },
  "QueuePdrs": {
    "queueUrl": "{{$.meta.queues.startSF}}",
    "parsePdrMessageTemplateUri": "{{$.meta.templates.ParsePdr}}",
    "provider": "{{$.meta.provider}}",
    "collection": "{{$.meta.collection}}"
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
  "WorkflowFailed": {}
}
JSON

  state_machine_definition = <<JSON
{
  "Comment": "Discovers new PDRs from a given provider",
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
      "Next": "DiscoverPdrs"
    },
    "DiscoverPdrs": {
      "Type": "Task",
      "Resource": "${module.cumulus.discover_pdrs_task_lambda_function_arn}",
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
      "Next": "QueuePdrs"
    },
    "QueuePdrs": {
      "Type": "Task",
      "Resource": "${module.cumulus.queue_pdrs_task_lambda_function_arn}",
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
