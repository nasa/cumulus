---
id: throttling-queued-executions
title: Throttling queued executions
hide_title: true
---

# Throttling queued executions

In this entry, we will walkthrough how to create an SQS queue for scheduling executions which will be limit those executions to a maximum concurrency. And we will see how to configure our Cumulus workflows/rules to use this queue.

## Why

Limiting the number of executions that can be running from a given queue is useful for controlling the cloud resource usage of workflows that may be lower priority, such as granule reingestion or reprocessing campaigns.

Using separate queues to schedule lower priority work versus a single queue prevents the consumption of lower priority messages from being a bottleneck for higher priority messages and their workflows.

## How it works

![Architecture diagram showing how queued execution throttling works](assets/queued-execution-throttling.png)

Execution throttling based on the queue works by manually keeping a count of how many executions are running for the queue at a time. The key operation that prevents the number of executions from exceeding the maximum for the queue is that before starting new executions, the `sqs2sfThrottle` lambda attempts to increment the semaphore and responds as follows:

- If the increment operation is successful, then the count was not at the maximum and an execution is started
- If the increment operation fails, then the count was already at the maximum so no execution is started

Using a semaphore allows the maximum number of executions to be **based on the queue, not the workflow for a given execution message**. Thus, the number of executions that are running for a given queue will be limited to the maximum for that queue regardless of which workflow(s) are started.

## Implementing a queue for throttling executions

### Create and deploy the queue

#### Define a queue with a maximum number of executions

In your `app/config.yml`, define a new queue with a `maxExecutions` value:

```yaml
  sqs:
    backgroundJobQueue:
      visibilityTimeout: 60
      retry: 30
      maxExecutions: 5
      consumer:
        - lambda: sqs2sfThrottle    # you must use this lambda
          schedule: rate(1 minute)
          messageLimit: '{{sqs_consumer_rate}}'
          state: ENABLED
```

**Please note that you must use the `sqs2sfThrottle` lambda as the consumer for this queue** or else the execution throttling will not work correctly.

#### Re-deploy your Cumulus app

Once you [re-deploy your Cumulus application](../deployment/deployment-readme#update-cumulus), all of your workflow templates will be updated to the include information about your queue (the output below is partial output from an expected workflow template):

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

#### Integrate queue with queuing steps in SIPS workflows

For any SIPS workflows using `queue-granules` or `queue-pdrs` that you want to use your new queue, update the Cumulus configuration of those steps in your workflows.

```yaml
  QueueGranules:
    CumulusConfig:
      provider: '{$.meta.provider}'
      internalBucket: '{$.meta.buckets.internal.name}'
      stackName: '{$.meta.stack}'
      granuleIngestMessageTemplateUri: '{$.meta.templates.IngestGranule}'
      # configure the step to use your new queue
      queueUrl: '{$.meta.queues.backgroundJobQueue}'
```

```yaml
  QueuePdrs:
    CumulusConfig:
      # configure the step to use your new queue
      queueUrl: '{$.meta.queues.backgroundJobQueue}'
      parsePdrMessageTemplateUri: '{$.meta.templates.ParsePdr}'
      provider: '{$.meta.provider}'
      collection: '{$.meta.collection}'
```

After making these changes, re-deploy your Cumulus application for the execution throttling to take effect.

#### Create/update a rule to use your new queue

Create or update a rule definition to include a `queueName` property that refers to your new queue:

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
