---
id: queue_granules
title: Queue Granules
hide_title: false
---

This task utilizes the Cumulus Message Adapter to interpret and construct incoming and outgoing messages.

Links to the npm package, task input, output and configuration schema definitions, and more can be found on the auto-generated [Cumulus Tasks](../tasks) page.

## Summary

The purpose of this task is to schedule ingest of granules that were discovered on a remote host, whether via the [DiscoverGranules](./discover_granules) task or the [ParsePDR](./parse_pdr) task.

The task utilizes a defined [collection](../configuration/data-management-types#collections) in concert with a defined [provider](../configuration/data-management-types#providers), either on each granule, or passed in via config to queue up ingest executions for each granule, or for batches of granules.

The constructed granules object is defined by the collection passed in the configuration, and has impacts to other provided core [Cumulus Tasks](../tasks).

Users of this task in a workflow are encouraged to carefully consider their configuration in context of downstream tasks and workflows.

## Task Inputs

Each of the following sections are a high-level discussion of the intent of the various input/output/config values.

For the most recent config.json schema, please see the [Cumulus Tasks page](../tasks) entry for the schema.

### Input

This task expects an incoming input that contains granules and information about them and their files. For the specifics, see the [Cumulus Tasks page](../tasks) entry for the schema.

This input is most commonly the output from a preceding [DiscoverGranules](./discover_granules) or [ParsePDR](./parse_pdr) task.

### Cumulus Configuration

This task does expect values to be set in the `task_config` CMA parameters for the workflows.  A schema exists that defines the requirements for the task.

For the most recent config.json schema, please see the [Cumulus Tasks page](../tasks) entry for the schema.

Below are expanded descriptions of selected config keys:

#### `provider`

A Cumulus [provider](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js) object for the originating provider. Will be passed along to the ingest workflow. This will be overruled by more specific provider information that may exist on a granule.

#### `internalBucket`

The Cumulus internal system bucket.

#### `granuleIngestWorkflow`

A string property that denotes the name of the ingest workflow into which granules should be queued.

#### `queueUrl`

A string property that denotes the URL of the queue to which scheduled execution messages are sent.

#### `preferredQueueBatchSize`

A number property that sets an upper bound on the size of each batch of granules queued into the payload of an ingest execution. Setting this property to a value higher than 1 allows queueing of multiple granules per ingest workflow.

As ingest executions typically expect granules in the payload to have a common collection and common provider, this property only sets an upper bound within which batches will be created based on common collection and provider information.

This means batches may be smaller than the preferred size if collection or provider information diverge, but never larger.

The default value if none is specified is 1, which will queue one ingest execution per granule.

#### `concurrency`

A number property that determines the level of concurrency with which ingest executions are scheduled.
Granules or batches of granules will be queued up into executions at this level of concurrency.

This property is also used to limit concurrency when updating granule status to `queued`.

Limiting concurrency helps to avoid throttling by the AWS Lambda API and helps to avoid encountering account Lambda concurrency limitations.

We do not recommend increasing this value unless you are seeing Lambda.Timeout errors when queue-granules receives a large number of granules as input. However, as increasing the concurrency may lead to Lambda API or Lambda concurrency throttling errors, you may wish to consider converting the queue-granules task to an ECS activity, which does not face similar runtime constraints.

The default value is 3.

#### `executionNamePrefix`

A string property that will prefix the names of scheduled executions.

#### `childWorkflowMeta`

An object property that will be merged into the scheduled execution input's `meta` field.

## Task Outputs

This task outputs an assembled array of workflow execution ARNs for all scheduled workflow executions within the payload's `running` object.
