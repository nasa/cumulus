module "discover_granules_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "DiscoverGranules"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.default_tags

  state_machine_definition = <<JSON
{
  "Comment": "Discovers new Granules from a given provider",
  "StartAt": "DiscoverGranules",
  "TimeoutSeconds": 18000,
  "States": {
    "DiscoverGranules": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "ReplaceConfig": {
            "FullMessage": true
          },
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
          "ReplaceConfig": {
            "FullMessage": true
          },
          "task_config": {
            "queueUrl": "{$.meta.queues.startSF}",
            "provider": "{$.meta.provider}",
            "internalBucket": "{$.meta.buckets.internal.name}",
            "stackName": "{$.meta.stack}",
            "granuleIngestWorkflow": "${module.ingest_granule_workflow.name}"
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
