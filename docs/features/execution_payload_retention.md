---
id: execution_payload_retention
title: Execution Payload Retention
hide_title: false
---

In addition to CloudWatch logs and AWS StepFunction API records, Cumulus automatically stores the initial and 'final' (the last update to the execution record) payload values as part of the Execution record in your RDS database and Elasticsearch.

This allows access via the API (or optionally direct DB/Elasticsearch querying) for debugging/reporting purposes.    The data is stored in the "originalPayload" and "finalPayload" fields.

## Payload record cleanup

To reduce storage requirements, a CloudWatch rule (`{stack-name}-dailyExecutionPayloadCleanupRule`) triggering a daily run of the provided cleanExecutions lambda has been added.  This lambda will remove a batch of payload records in the database that are older than the specified configuration.

## Execution backlog cleanup

Because many users have accumulated a substantial backlog of un-cleaned execution payloads, this lambda specifies an update_limit configuration to avoid overwhelming elasticsearch and hogging too many resources.
For backlog cleanup it is recommended the following
  - set the daily_execution_payload_cleanup_schedule_expression to run this hourly: `"cron(0 * * * ? *)"`
  - a conservative update_limit is 1,000,000: this has been tested to be workable on a 1 node t2.small.search cluster
Starting with this configuration 24 million es records per day can be cleaned up.
Once backlog has been taken care of, a similar configuration should be able to run once per day and keep up with ingest rate

### Configuration

The following configuration flags have been made available in the `cumulus` module. They may be overridden in your deployment's instance of the `cumulus` module by adding the following configuration options:

#### daily_execution_payload_cleanup_schedule_expression _(string)_

This configuration option sets the execution times for this Lambda to run, using a Cloudwatch cron expression.

Default value is `"cron(0 4 * * ? *)"`.

#### cleanup_running _(bool)_

This configuration option, when set to true, will enable cleanup of `running` execution payloads.

Default value is `false`.

#### cleanup_non_running _(bool)_

This configuration option, when set to true, will enable cleanup of non -running (any status _other_ than `running`) execution payloads.

Default value is `true`.

#### payload_timeout _(number)_

This configuration defines the number of days after which an execution record will be slated for cleanup by this script.

Default value is 10

#### es_index _(string)_

this configuration defines the elasticsearch index to search in for elasticsearch executions to clean up

Default value is `cumulus`


