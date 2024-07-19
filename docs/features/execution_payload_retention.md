---
id: execution_payload_retention
title: Execution Payload Retention
hide_title: false
---

In addition to CloudWatch logs and AWS StepFunction API records, Cumulus automatically stores the initial and 'final' (the last update to the execution record) payload values as part of the Execution record in your RDS database and Elasticsearch.

This allows access via the API (or optionally direct DB/Elasticsearch querying) for debugging/reporting purposes.    The data is stored in the "originalPayload" and "finalPayload" fields.

## Payload record cleanup

To reduce storage requirements, a CloudWatch rule (`{stack-name}-dailyExecutionPayloadCleanupRule`) triggering a daily run of the provided cleanExecutions lambda has been added.  This lambda will remove a batch of payload records in the database that are older than the specified configuration.

### Asynchronous es task

The cleanExecutions lambda launches an asynchronous elasticsearch cleanup task which can be accessed from outside of the lambda function.

To poll the task's current status use 
``` bash
 > curl --request GET ${es_endpoint}/_tasks/${task_id}
```
to cancel the task use
``` bash
 > curl --request POST ${es_endpoint}/_tasks/${task_id}/_cancel
```
Upon launch of this elasticsearch task, the cleanExecutions lambda will log the task_id needed above, along with its best guess (subject to change if you are ssh tunnelling to the es cluster etc.) of the es_endpoint and formatted curl commands 

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


