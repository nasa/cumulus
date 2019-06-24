---
id: throttling-queued-executions
title: Throttling queued executions
hide_title: true
---

# Throttling queued executions

In this entry, we will walkthrough how to create an SQS queue that can be used to limit on the amount of concurrent executions started from that queue. And we will see how to configure our Cumulus workflows to use this queue.

## Background

Cumulus uses SQS queues to schedule executions of state machines defined as AWS Step Functions.

There are several Lambdas in Cumulus which are responsible for sending execution messages to SQS:

- `queue-granules`
- `queue-pdrs`
- `sf-scheduler`

`queue-granules` and `queue-pdrs` are usually invoked as steps in a [SIPS workflow](data-cookbooks/sips-workflow.md). They are usually used to schedule the ingest workflows for data once it has been discovered from a remote source or notification.

`sf-scheduler` is invoked by the Rules API, which is explained in more detail in the [Workflow Triggers data cookbook](data-cookbooks/workflow-triggers).

Once these tasks send the execution messages to the queue, a separate Lambda named `sqs2sf` polls those queues, receives the messages, and starts an execution of the state machine defined for each message.

By default, these messages are sent to the `startSF` queue that is included with a Cumulus deployment. While there are limits to how many messages the `sqs2sf` Lambda will attempt to read at once, there are no limits to how many concurrent executions of any given state machine it will start.

## How it works

For whichever workflows to which you apply this change, the maximum number of executions for

## Create and deploy a queue for throttling executions

### Define a queue with a maximum number of executions

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

### Re-deploy your Cumulus app

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

## Integrate your queue with workflows and/or rules

### Integrate queue with queuing steps in SIPS workflows

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

### Create/update a rule to use your new queue

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
