---
id: version-v1.16.0-interfaces
title: Interfaces
hide_title: false
original_id: interfaces
---

Cumulus has multiple interfaces that allow interaction with discrete components of the system, such as starting workflows via SNS/Kinesis/SQS, manually queueing workflow start messages, submitting SNS notifications for completed workflows, and the many operations allowed by the Cumulus API.

The diagram below illustrates the workflow process in detail and the various interfaces that allow starting of workflows, reporting of workflow information, and database create operations that occur when a workflow reporting message is processed. For interfaces with expected input or output schemas, details are provided below.

**Note:** This diagram is current of v1.15.0.

![Architecture diagram showing the interfaces for triggering and reporting of Cumulus workflow executions](../assets/interfaces.svg)

## Workflow triggers and queuing

### Kinesis stream

As a Kinesis stream is consumed by the `messageConsumer` Lambda to queue workflow executions, the incoming event is validated against [this consumer schema](https://github.com/nasa/cumulus/blob/master/packages/api/lambdas/kinesis-consumer-event-schema.json) by the [`ajv` package](https://www.npmjs.com/package/ajv).

### SQS queue for executions

The messages put into the SQS queue for executions should conform to the [Cumulus message format](workflows/cumulus-task-message-flow.md#cumulus-message-format).

## Workflow executions

See the [documentation on Cumulus workflows](./workflows/README.md).

## Workflow reporting

### SNS reporting topics

For granule and PDR reporting, the topics will only receive data if the [Cumulus workflow execution message](workflows/cumulus-task-message-flow.md#cumulus-message-format) meets the following criteria:

- Granules - workflow message contains granule data in `payload.granules`
- PDRs - workflow message contains PDR data in `payload.pdr`

The messages published to the SNS reporting topics (executions, granules, PDRs) should conform to the [model schema](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js) for each data type.

Further detail on workflow SNS reporting and how to interact with these interfaces can be found in the [SNS workflow notifications data cookbook](data-cookbooks/sns.md).

### Cumulus API

See the [Cumulus API documentation](https://nasa.github.io/cumulus-api/).
