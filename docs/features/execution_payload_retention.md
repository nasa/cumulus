---
id: execution_payload_retention
title: Execution Payload Retention
hide_title: true
---

# Execution Payload Retention

In addition to CloudWatch logs and AWS StepFunction API records, Cumulus automatically stores the initial and 'final' (the last update to the execution record) payload values as part of the Execution record in DynamoDB and Elasticsearch.

This allows access via the API (or optionally direct DB/Elasticsearch querying) for debugging/reporting purposes.    The data is stored in the "originalPayload" and "finalPayload" fields.

## Payload record cleanup

To reduce storage requirements, a CloudWatch rule (`{stack-name}-dailyExecutionPayloadCleanupRule`) triggering a daily run of the provided cleanExecutions lambda has been added.  This lambda will remove all 'completed' and 'non-completed' payload records in the database that are older than the specified configuration.

### Configuration

The following configuration flags have been made available in the `cumulus` module.   They may be overridden in your deployment's instance of the `cumulus` module by adding the following configuration options:

#### daily_execution_payload_cleanup_schedule_expression _(string)_

This configuration option sets the execution times for this Lambda to run, using a Cloudwatch cron expression.

Default value is `"cron(0 4 * * ? *)"`.

#### complete_execution_payload_timeout_disable _(bool)_

This configuration option, when set to true, will disable all cleanup of `completed` execution payloads.

Default value is `false`.

#### complete_execution_payload_timeout _(number)_

This flag defines the cleanup threshold for executions with a 'completed' status in days.   Records with `updatedAt` values older than this with payload information  will have that information removed.

Default value is `10`.

#### non_complete_execution_payload_timeout_disable _(bool)_

This configuration option, when set to true, will disable all cleanup of "non-complete" (any status _other_ than `completed`) execution payloads.

Default value is `false`.

#### non_complete_execution_payload_timeout _(number)_

This flag defines the cleanup threshold for executions with a status other than 'complete' in days.   Records with updateTime values older than this with payload information  will have that information removed.

Default value is 30 days.

- complete_execution_payload_disable/non_complete_execution_payload_disable

These flags (true/false) determine if the cleanup script's logic for 'complete' and 'non-complete' executions will run.   Default value is false for both.
