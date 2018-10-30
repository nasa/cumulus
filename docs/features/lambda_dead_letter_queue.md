# Lambda Dead Letter Queues

## Named Lambda Dead Letter Queues
Cumulus provides the ability to configure a default named [Dead Letter Queue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html) for lambdas.   This is intended to be utilized for non-workflow lambdas (such as ScheduleSF) to capture lambda failures for further processing.

Adding the folowing configuration to a lambda in `app/lambdas.yml`:

```
namedLambdaDeadLetterQueue: true
```

will create an SQS Dead Letter Queue named `{lambdaName}DeadLetterQueue` and set the lambda to target it.   The default retention configuration for this queue will be set with the following configurable values:

```
DLQDefaultTimeout: 60  ## SQS Message Timer
DLQDefaultMessageRetentionPeriod: 1209600 ## Squs Message Retention
```

These values can be overridden in the `app/config.yml` and will apply to all 'named' lambda Dead Letter Queues, subject to [AWS SQS Limits](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-limits.html)

## Default Lambda Configuration

The following built-in cumulus lambdas have this feature enabled by default to allow handling of process failures:

* dbIndexer (Updates elasticsearch based on DynamoDB events)
* ScheduleSF (The SF Scheduler lambda that places messages on the start SF queue, see [Workflow Triggers](../workflows/workflow-triggers.md)
* EmsReport (Daily EMS report generation lambda)
* log2elasticsearch (Lambda that exports logs into elastic search)
* sns2elasticsearch (API Lambda that takes a payload from a workflow and indexes it into elastic search)
