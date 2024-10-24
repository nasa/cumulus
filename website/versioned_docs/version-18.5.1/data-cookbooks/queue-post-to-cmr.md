---
id: queue-post-to-cmr
title: Queue PostToCmr
hide_title: false
---

In this document, we walk through handling CMR errors in workflows by queueing PostToCmr. We assume that the user already has an ingest workflow setup.

## Overview

The general concept is that the last task of the ingest workflow will be `QueueWorkflow`, which queues the publish workflow. The publish workflow contains the `PostToCmr` task and if a CMR error occurs during `PostToCmr`, the publish workflow will add itself back onto the queue so that it can be executed when CMR is back online. This is achieved by leveraging the `QueueWorkflow` task again in the publish workflow. The following diagram demonstrates this queueing process.

![Diagram of workflow queueing](../assets/queue-workflow.png)

## Ingest Workflow

The last step should be the `QueuePublishWorkflow` step. It should be configured with a queueUrl and workflow. In this case, the `queueUrl` is a [throttled queue](./throttling-queued-executions). Any `queueUrl` can be specified here which is useful if you would like to use a lower priority queue. The workflow is the unprefixed workflow name that you would like to queue (e.g. `PublishWorkflow`).

```json
  "QueuePublishWorkflowStep": {
    "Parameters": {
      "cma": {
        "event.$": "$",
        "ReplaceConfig": {
          "FullMessage": true
        },
        "task_config": {
          "internalBucket": "{$.meta.buckets.internal.name}",
          "stackName": "{$.meta.stack}",
          "workflow": "{$.meta.workflow}",
          "queueUrl": "${start_sf_queue_url}",
          "provider": "{$.meta.provider}",
          "collection": "{$.meta.collection}",
          "childWorkflowMeta": { "file_etags": "{$.meta.file_etags}", "staticValue": "aStaticValue" }
        }
      }
    },
    "Type": "Task",
    "Resource": "${queue_workflow_task_arn}",
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
```

## Publish Workflow

Configure the Catch section of your `PostToCmr` task to proceed to `QueueWorkflow` if a `CMRInternalError` is caught. Any other error will cause the workflow to fail.

```json
  "Catch": [
    {
      "ErrorEquals": [
        "CMRInternalError"
      ],
      "Next": "RequeueWorkflow"
    },
    {
      "ErrorEquals": [
        "States.ALL"
      ],
      "Next": "WorkflowFailed",
      "ResultPath": "$.exception"
    }
  ],
```

Then, configure the `QueueWorkflow` task similarly to its configuration in the ingest workflow. This time, pass the current publish workflow to the task config. This allows for the publish workflow to be requeued when there is a CMR error.

```json
{
  "RequeueWorkflow": {
    "Parameters": {
      "cma": {
        "event.$": "$",
        "task_config": {
          "buckets": "{$.meta.buckets}",
          "distribution_endpoint": "{$.meta.distribution_endpoint}",
          "workflow": "PublishGranuleQueue",
          "queueUrl": "${start_sf_queue_url}",
          "provider": "{$.meta.provider}",
          "collection": "{$.meta.collection}",
          "childWorkflowMeta": { "file_etags": "{$.meta.file_etags}", "staticValue": "aStaticValue" }
        }
      }
    },
    "Type": "Task",
    "Resource": "${queue_workflow_task_arn}",
    "Catch": [
      {
        "ErrorEquals": [
          "States.ALL"
        ],
        "Next": "WorkflowFailed",
        "ResultPath": "$.exception"
      }
    ],
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
    "End": true
  }
}  
  ```
