---
id: interfaces
title: Interfaces
hide_title: false
---

Cumulus has multiple interfaces that allow interaction with discrete components of the system, such as starting workflows via SNS/Kinesis/SQS, manually queueing workflow start messages, submitting SNS notifications for completed workflows, and the many operations allowed by the Cumulus API.

The diagram below illustrates the workflow process in detail and the various interfaces that allow starting of workflows, reporting of workflow information, and database create operations that occur when a workflow reporting message is processed. For interfaces with expected input or output schemas, details are provided below.

**Note:** This diagram is current of v1.15.0.

![Architecture diagram showing the interfaces for triggering and reporting of Cumulus workflow executions](../assets/interfaces.svg)

## Kinesis stream workflow trigger

As a Kinesis stream is consumed by the `messageConsumer` Lambda to queue workflow executions, the incoming event is validated against [this consumer schema](https://github.com/nasa/cumulus/blob/master/packages/api/lambdas/kinesis-consumer-event-schema.json) by the [`ajv` package](https://www.npmjs.com/package/ajv).
