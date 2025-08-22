---
id: execution_payload_retention
title: Execution Payload Retention
hide_title: false
---

In addition to CloudWatch logs and AWS StepFunction API records, Cumulus automatically stores the initial and 'final' (the last update to the execution record) payload values as part of the Execution record in your RDS database and Elasticsearch.

This allows access via the API (or optionally direct DB/Elasticsearch querying) for debugging/reporting purposes.    The data is stored in the "originalPayload" and "finalPayload" fields.

## Payload record cleanup

To reduce storage requirements, a CloudWatch rule (`{stack-name}-dailyExecutionPayloadCleanupRule`) triggering a daily run of the provided cleanExecutions lambda has been added.  This lambda will remove a batch of payload records in elasticsearch that are older than the specified configuration.

### Asynchronous es task

The cleanExecutions lambda launches an asynchronous elasticsearch cleanup task which can be monitored from outside of the lambda function.

To poll the task's current status use

``` bash
 > curl --request GET ${es_endpoint}/_tasks/${task_id}

 #{"completed":false,"task":{"node":"pmXVVuVLTDmkv5NWhQeoLg","id":3231161,"type":"transport","action":"indices:data/write/update/byquery","status":{"total":300000,"updated":12000,"created":0,"deleted":0,"batches":13,"version_conflicts":0,"noops":0,"retries":{"bulk":0,"search":0},"throttled_millis":0,"requests_per_second":-1.0,"throttled_until_millis":0},"description":"update-by-query [cumulus][execution] updated with Script{type=inline, lang='painless', idOrCode='ctx._source.remove('finalPayload'); ctx._source.remove('originalPayload')', options={}, params={}}","start_time_in_millis":1721400177604,"running_time_in_nanos":11020601675,"cancellable":true}}
 
```

to cancel the task use

``` bash
 > curl --request POST ${es_endpoint}/_tasks/${task_id}/_cancel
 
 #{"nodes":{"pmXVVuVLTDmkv5NWhQeoLg":{"name":"pmXVVuV","roles":["master","data","ingest"],"tasks":{"pmXVVuVLTDmkv5NWhQeoLg:3231161":{"node":"pmXVVuVLTDmkv5NWhQeoLg","id":3231161,"type":"transport","action":"indices:data/write/update/byquery","start_time_in_millis":1721400177604,"running_time_in_nanos":58473690222,"cancellable":true}}}}}
 
```

Upon launch of this elasticsearch task, the cleanExecutions lambda will log (accessible from CloudWatch) the task_id needed above, along with its best guess (subject to change if you are ssh tunnelling to the es cluster etc.) of the es_endpoint and formatted curl commands

## Execution backlog cleanup

To facilitate removing payloads for a large quantity of executions, this lambda specifies an update_limit configuration to avoid overwhelming elasticsearch.
For cleanup of existing execution payloads the following is recommended:

- set the daily_execution_payload_cleanup_schedule_expression to run this hourly: `"cron(0 * * * ? *)"`
- a conservative update_limit is 1,000,000: this has been tested to be workable on a 1 node t2.small.search cluster

Starting with this configuration, 24 million Elasticsearch records per day can be cleaned up. A more aggressive schedule is likely possible, but will need testing in SIT/UAT to ensure compatibility with cluster configuration.
Once the older executions have been taken care of, a similar configuration should be able to run once per day and keep up with ingest rate

### Configuration

The following configuration flags have been made available in the `cumulus` module. They may be overridden in your deployment's instance of the `cumulus` module by adding the following configuration options:

#### daily_execution_payload_cleanup_schedule_expression _(string)_

This configuration option sets the execution times for this Lambda to run, using a Cloudwatch cron expression.

Default value is `"cron(0 4 * * ? *)"`.

#### cleanup_running _(bool)_

This configuration option, when set to true, will enable cleanup of `running` execution payloads.

Default value is `false`.

#### cleanup_non_running _(bool)_

This configuration option, when set to true, will enable cleanup of non-running (any status _other_ than `running`) execution payloads.

Default value is `true`.

#### payload_timeout _(number)_

This configuration defines the number of days after which an execution record will be slated for cleanup by this script.

Default value is 10

#### update_limit _(number)_

This configuration defines the maximum number of executions to clean up in one run.

default value is 10,000

#### es_index _(string)_

this configuration defines the elasticsearch index to search in for elasticsearch executions to clean up

Default value is `cumulus`
