---
id: dead_letter_queues
title: Dead Letter Queues
hide_title: true
---

# Cumulus Dead Letter Queues

## startSF SQS queue

The [workflow-trigger](../workflows/workflow-triggers) for the startSF queue has a [Redrive Policy](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-sqs-queues-redrivepolicy.html) set up that directs any failed attempts to pull from the workflow start queue to a SQS queue [Dead Letter Queue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html).

This queue can then be monitored for failures to initiate a workflow.   Please note that workflow failures will not show up in this queue, only repeated failure to trigger a workflow.

## Named Lambda Dead Letter Queues
Cumulus provides the ability to configure a default named [Dead Letter Queue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html) for lambdas.   This is intended to be utilized for non-workflow lambdas (such as ScheduleSF) to capture lambda failures for further processing.

Adding the following configuration to a lambda in `app/lambdas.yml`:

```
namedLambdaDeadLetterQueue: true
```

will create an SQS Dead Letter Queue named `{lambdaName}DeadLetterQueue` and set the lambda to target it.   The default retention configuration for this queue will be set with the following configurable values:

```
DLQDefaultTimeout: 60  ## SQS Message Timer
DLQDefaultMessageRetentionPeriod: 1209600 ## SQS Message Retention
```

These values can be overridden in the `app/config.yml` and will apply to all 'named' lambda Dead Letter Queues, subject to [AWS SQS Limits](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-limits.html)

#### Default Lambda Configuration

The following built-in cumulus lambdas have this feature enabled by default to allow handling of process failures:

* dbIndexer (Updates Elasticsearch based on DynamoDB events)
* EmsIngestReport (Daily EMS ingest report generation lambda)
* JobsLambda (writes logs outputs to Elasticsearch)
* log2elasticsearch (Lambda that exports logs into Elasticsearch)
* ScheduleSF (The SF Scheduler lambda that places messages on the start SF queue, see [Workflow Triggers](../workflows/workflow-triggers.md))
* sns2elasticsearch (API Lambda that takes a payload from a workflow and indexes it into Elasticsearch)

## Troubleshooting/Utilizing messages in a [Dead Letter Queue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)

Ideally an automated process should be configured to poll the queue and process messages off a dead letter queue.

For aid in manually troubleshooting, you can utilize the [SQS Management console](https://console.aws.amazon.com/sqs/home) to view/messages available in the queues setup for a particular stack.    The dead letter queues will have a Message Body containing the lambda payload, as well as Message Attributes that reference both the error returned and a RequestID which can be cross referenced to the associated Lambda's CloudWatch logs for more information:

![sqs message attributes](assets/sqs_message_attribute.png)
