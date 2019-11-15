---
id: throttling-queued-executions
title: Throttling queued executions
hide_title: true
---

# Throttling queued executions

In this entry, we will walkthrough how to create an SQS queue for scheduling executions which will be used to limit those executions to a maximum concurrency. And we will see how to configure our Cumulus workflows/rules to use this queue.

We will also review the architecture of this feature and highlight some implementation notes.

Limiting the number of executions that can be running from a given queue is useful for controlling the cloud resource usage of workflows that may be lower priority, such as granule reingestion or reprocessing campaigns. It could also be useful for preventing workflows from exceeding known resource limits, such as a maximum number of open connections to a data provider.

## Implementing the queue

### Create and deploy the queue

#### Add a new queue

In a `.tf` file for your [Cumulus deployment](./../deployment/deployment-readme#deploy-the-cumulus-instance), add a new SQS queue:

```hcl
resource "aws_sqs_queue" "background_job_queue" {
  name                       = "${var.prefix}-backgroundJobQueue"
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = 60
}
```

#### Set maximum executions for the queue

Define the `throttled_queues` variable for the `cumulus` module in your [Cumulus deployment](./../deployment/deployment-readme#deploy-the-cumulus-instance) to specify the maximum concurrent executions for the queue.

> **Please note:** The `id` used to identify the new queue is arbitrary, but **will be used to refer to this queue later when configuring workflows and rules**.

```hcl
module "cumulus" {
  # ... other variables

  throttled_queues = [{
    id = "backgroundJobQueue",
    url = aws_sqs_queue.background_job_queue.id,
    execution_limit = 5
  }]
}
```

#### Setup consumer for the queue

Add the `sqs2sfThrottle` Lambda as the consumer for the queue and add a Cloudwatch event rule/target to read from the queue on a scheduled basis.

> **Please note**: You **must use the `sqs2sfThrottle` Lambda as the consumer for any queue with a queue execution limit** or else the execution throttling will not work correctly. Additionally, please allow at least 60 seconds after creation before using the queue while associated infrastructure and triggers are set up and made ready.

`aws_sqs_queue.background_job_queue.id` refers to the [queue resource defined above](#add-a-new-queue).

```hcl
resource "aws_cloudwatch_event_rule" "background_job_queue_watcher" {
  schedule_expression = "rate(1 minute)"
}

resource "aws_cloudwatch_event_target" "background_job_queue_watcher" {
  rule = aws_cloudwatch_event_rule.background_job_queue_watcher.name
  arn  = module.cumulus.sqs2sfThrottle_lambda_function_arn
  input = jsonencode({
    messageLimit = 500
    queueUrl     = aws_sqs_queue.background_job_queue.id
    timeLimit    = 60
  })
}

resource "aws_lambda_permission" "background_job_queue_watcher" {
  action        = "lambda:InvokeFunction"
  function_name = module.cumulus.sqs2sfThrottle_lambda_function_arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.background_job_queue_watcher.arn
}
```

#### Re-deploy your Cumulus application

Follow the instructions to [re-deploy your Cumulus application](./../deployment/upgrade-readme#update-cumulus-resources). After you have re-deployed, your workflow template will be updated to the include information about the queue (the output below is partial output from an expected workflow template):

```json
{
  "meta": {
    "queues": {
      "backgroundJobQueue": "<backgroundJobQueue_SQS_URL>"
    },
    "queueExecutionLimits": {
      "backgroundJobQueue": 5
    }
  }
}
```

### Integrate your queue with workflows and/or rules

#### Integrate queue with queuing steps in workflows

For any workflows using `QueueGranules` or `QueuePdrs` that you want to use your new queue, update the Cumulus configuration of those steps in your workflows.

As seen in this partial configuration for a `QueueGranules` step (a full example of the step definition can be found in the [discover granules workflow](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/discover_granules_workflow.tf)), update the `queueUrl` to reference the new throttled queue:

```json
{
  "QueueGranules": {
    "Parameters": {
      "cma": {
        "event.$": "$",
        "ReplaceConfig": {
          "FullMessage": true
        },
        "task_config": {
          "queueUrl": "{$.meta.queues.backgroundJobQueue}",
          "provider": "{$.meta.provider}",
          "internalBucket": "{$.meta.buckets.internal.name}",
          "stackName": "{$.meta.stack}",
          "granuleIngestWorkflow": "${module.ingest_granule_workflow.name}"
        }
      }
    }
  }
}
```

> **Please note:** Make sure that the last component of the JSON path for the `queueUrl` (`backgroundJobQueue` of `$.meta.queues.backgroundJobQueue`) used to identify the queue matches the `id` that was [defined previously for the queue](#set-maximum-executions-for-the-queue).

Similarly, for a `QueuePdrs` step (see [example discover PDRs workflow](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/discover_and_queue_pdrs_workflow.tf) for full step definition):

```json
{
  "QueuePdrs": {
    "Parameters": {
      "cma": {
        "event.$": "$",
        "ReplaceConfig": {
          "FullMessage": true
        },
        "task_config": {
          "queueUrl": "{$.meta.queues.backgroundJobQueue}",
          "provider": "{$.meta.provider}",
          "collection": "{$.meta.collection}",
          "internalBucket": "{$.meta.buckets.internal.name}",
          "stackName": "{$.meta.stack}",
          "parsePdrWorkflow": "${module.parse_pdr_workflow.name}"
        }
      }
    }
  }
}
```

After making these changes, [re-deploy your Cumulus application](./../deployment/upgrade-readme#update-cumulus-resources) for the execution throttling to take effect on workflow executions queued by these workflows.

#### Create/update a rule to use your new queue

Create or update a rule definition to include a `queueName` property that refers to your new queue, where `queueName` matches the `id` that was [defined previously for the queue](#set-maximum-executions-for-the-queue):

```json
{
  "name": "s3_provider_rule",
  "workflow": "DiscoverAndQueuePdrs",
  "provider": "s3_provider",
  "collection": {
    "name": "MOD09GQ",
    "version": "006"
  },
  "rule": {
    "type": "onetime"
  },
  "state": "ENABLED",
  "queueName": "backgroundJobQueue" // configure rule to use your queue
}
```

After creating/updating the rule, any subsequent invocations of the rule should respect the maximum number of executions when starting workflows from the queue.

## Architecture

![Architecture diagram showing how executions started from a queue are throttled to a maximum concurrent limit](assets/queued-execution-throttling.png)

Execution throttling based on the queue works by manually keeping a count (semaphore) of how many executions are running for the queue at a time. The key operation that prevents the number of executions from exceeding the maximum for the queue is that before starting new executions, the `sqs2sfThrottle` Lambda attempts to increment the semaphore and responds as follows:

- If the increment operation is successful, then the count was not at the maximum and an execution is started
- If the increment operation fails, then the count was already at the maximum so no execution is started

## Final notes

Limiting the number of concurrent executions for work scheduled via a queue has several consequences worth noting:

- The number of executions that are running for a given queue will be limited to the maximum for that queue regardless of which workflow(s) are started.
- If you use the same queue to schedule executions across multiple workflows/rules, then the limit on the total number of executions running concurrently **will be applied to all of the executions scheduled across all of those workflows/rules**.
- If you are scheduling the same workflow both via a queue with a `maxExecutions` value and a queue without a `maxExecutions` value, **only the executions scheduled via the queue with the `maxExecutions` value will be limited to the maximum**.
