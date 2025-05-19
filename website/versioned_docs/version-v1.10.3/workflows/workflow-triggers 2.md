---
id: version-v1.10.3-workflow-triggers
title: Workflow Triggers
hide_title: true
original_id: workflow-triggers
---

# Workflow Triggers
For a workflow to run, it needs to be associated with a rule (see [rule configuration](data-cookbooks/setup.md#rules). The rule configuration determines how and when a workflow execution is triggered. Rules can be triggered one time, on a schedule, or by new data written to a kinesis stream.

There are three lambda functions in the API package responsible for scheduling and starting workflows: `SF scheduler`, `kinesis consumer`, `and SF starter`. Each Cumulus instance comes with a Start SF [SQS queue](https://aws.amazon.com/sqs/).

The `SF scheduler` lambda puts a message onto the `start SF` queue. This message is picked up the `Start SF` lambda and an execution is started with the body of the message as the input.

When a one time rule is created, the `schedule SF` lambda is triggered. Rules that are not one time are associated with a [CloudWatch event](https://docs.aws.amazon.com/AmazonCloudWatch/latest/events/WhatIsCloudWatchEvents.html) which will manage the trigger of the lambdas that trigger the workflows.

For a scheduled rule, the Cloudwatch event is triggered on the given schedule which calls directly to the `schedule SF` lambda. For a kinesis rule, when data is added to the kinesis stream, the Cloudwatch event is triggered, which calls the `kinesis consumer` lambda. The `kinesis consumer` lambda parses the kinesis message and finds all of the rules associated with that message. For each rule (which corresponds to one workflow), the `schedule SF` lambda is triggered to queue a message to start the workflow.

![](assets/schedule-workflows.png)
