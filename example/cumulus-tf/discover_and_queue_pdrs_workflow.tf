module "discover_and_queue_pdrs_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "DiscoverAndQueuePdrs"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.default_tags

  state_machine_definition = <<JSON
{
  "Comment": "Discovers new PDRs from a given provider",
  "StartAt": "DiscoverPdrs",
  "States": {
    "DiscoverPdrs": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "ReplaceConfig": {
            "FullMessage": true
          },
          "task_config": {
            "stack": "{$.meta.stack}",
            "provider": "{$.meta.provider}",
            "bucket": "{$.meta.buckets.internal.name}",
            "collection": "{$.meta.collection}"
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.discover_pdrs_task.task_arn}",
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
      "Next": "QueuePdrs"
    },
    "QueuePdrs": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "ReplaceConfig": {
            "FullMessage": true
          },
          "task_config": {
            "queueUrl": "{$.meta.queues.startSF}",
            "provider": "{$.meta.provider}",
            "collection": "{$.meta.collection}",
            "internalBucket": "{$.meta.buckets.internal.name}",
            "stackName": "{$.meta.stack}",
            "parsePdrWorkflow": "${module.parse_pdr_workflow.name}"
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.queue_pdrs_task.task_arn}",
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
