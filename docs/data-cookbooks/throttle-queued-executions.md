---
id: throttling-queued-executions
title: Throttling queued executions
hide_title: true
---

# Throttling queued executions

In this entry, we will walkthrough how to create an SQS queue that only allows a limited number of executions to be running from it concurrently. And we will see how to configure our Cumulus workflows to use this queue so that we can throttle executions started from that queue.

## Background

Cumulus uses SQS queues to schedule executions of state machines defined as AWS Step Functions. There are several Lambdas in Cumulus which are responsible for sending execution messages to SQS:

- `queue-granules`
- `queue-pdrs`
- `sf-scheduler`

Once these tasks send the execution messages to the queue, a separate Lambda named `sqs2sf` polls those queues, receives the messages, and starts an execution of the state machine defined for each message.

By default, these messages are sent to the `startSF` queue that is included with a Cumulus deployment. While there are limits to how many messages the `sqs2sf` Lambda will attempt to read at once, there are no limits to how many concurrent executions of any given state machine it will start.

## Define a queue with a maximum executions

```yaml
  sqs:
    backgroundJobQueue:
      visibilityTimeout: 60
      retry: 30
      consumer:
        - lambda: sqs2sfThrottle    # you must use this lambda
          schedule: rate(1 minute)
          messageLimit: '{{sqs_consumer_rate}}'
          state: ENABLED
```
