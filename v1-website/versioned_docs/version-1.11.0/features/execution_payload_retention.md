---
id: version-1.11.0-execution_payload_retention
title: Execution Payload Retention
hide_title: true
original_id: execution_payload_retention
---

# Execution Payload Retention

In addition to CloudWatch logs and AWS StepFunction API records, Cumulus automatically stores the initial and 'final' (the last update to the execution record) payload values as part of the Execution record in DynamoDB and Elasticsearch.

This allows access via the API (or optionally direct DB/Elasticsearch querying) for debugging/reporting purposes.    The data is stored in the "originalPayload" and "finalPayload" fields.

## Payload record cleanup

To reduce storage requirements, a CloudWatch rule (`{stack-name}-dailyExecutionPayloadCleanupRule`) triggering a daily run of the provided cleanExecutions lambda has been added.  This lambda will remove all 'completed' and 'non-completed' payload records in the database that are older than the specified configuration.

### Configuration

The following configuration flags have been added.  They may be overridden in your deployment configuration by adding the appropriate keys:

- complete_execution_payload_timeout

This flag defines the cleanup threshold for executions with a 'complete' status in days.   Records with updateTime values older than this with payload information  will have that information removed.

Default value is 10 days.

- non_complete_execution_payload_timeout

This flag defines the cleanup threshold for executions with a status other than 'complete' in days.   Records with updateTime values older than this with payload information  will have that information removed.

Default value is 30 days.

- complete_execution_payload_disable/non_complete_execution_payload_disable

These flags (true/false) determine if the cleanup script's logic for 'complete' and 'non-complete' executions will run.   Default value is false for both.

#### Default configuration example:

```
  non_complete_execution_payload_timeout: 30
  complete_execution_payload_timeout: 10
  complete_execution_payload_disable: false
  non_complete_execution_payload_disable: false
```
