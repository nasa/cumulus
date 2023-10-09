---
id: task-configuration
title: Configuration of Tasks
hide_title: false
---

The `cumulus` module exposes values for configuration for some of the provided archive and ingest tasks.   Currently the following are available as configurable variables:

## cmr_search_client_config

Configuration parameters for CMR search client for cumulus archive module tasks in the form:

```hcl
<lambda_identifier>_report_cmr_limit = <maximum number records can be returned from cmr-client search, this should be greater than cmr_page_size>
<lambda_identifier>_report_cmr_page_size = <number of records for each page returned from CMR>
  type = map(string)
```

More information about cmr limit and cmr page_size can be found from [@cumulus/cmr-client](https://github.com/nasa/cumulus/blob/master/packages/cmr-client/src/searchConcept.ts) and [CMR Search API document](https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html#query-parameters).

Currently the following values are supported:

- create_reconciliation_report_cmr_limit
- create_reconciliation_report_cmr_page_size

### Example

```tf
cmr_search_client_config = {
  create_reconciliation_report_cmr_limit = 2500
  create_reconciliation_report_cmr_page_size = 250
}
```

## elasticsearch_client_config

Configuration parameters for Elasticsearch client for cumulus archive module tasks in the form:

```hcl
<lambda_identifier>_es_scroll_duration = <duration>
<lambda_identifier>_es_scroll_size = <size>
  type = map(string)
```

Currently the following values are supported:

- create_reconciliation_report_es_scroll_duration
- create_reconciliation_report_es_scroll_size

### Example

```tf
elasticsearch_client_config = {
  create_reconciliation_report_es_scroll_duration = "15m"
  create_reconciliation_report_es_scroll_size = 2000
}
```

## lambda_timeouts

A configurable map of timeouts (in seconds) for cumulus ingest module task lambdas in the form:

```hcl
<lambda_identifier>_timeout: <timeout>
  type = map(string)
```

Currently the following values are supported:

- AddMissingFileChecksums
- ApiEndpoints
- bulkOperation
- cleanExecutions
- CreateReconciliationreport
- CustomBootstrap
- DiscoverGranules
- DiscoverPdrs
- DistributionApiEndpoints
- FakeProcessing
- fallbackConsumer
- FilesToGranules
- HelloWorld
- HyraxMetadataUpdates
- IndexFromDatabase
- KinesisInboundEventLogger
- KinesisOutboundEventLogger
- LzardsBackup
- manualConsumer
- messageConsumer
- MoveGranules
- OrcaCopyToArchiveAdapter
- OrcaRecoveryAdapter
- ParsePdr
- PdrStatusCheck
- PostToCmr
- PrivateApiLambda
- processDeadLetterArchive
- ProvisionPostgresDatabase
- QueueGranules
- QueuePdrs
- QueueWorkflow
- replaySqsMessages
- s3-credentials-endpoint
- ScheduleSF
- SendPan
- sfSemaphoreDown
- SfSqsReport
- sqs2sfThrottle
- sqsMessageConsumer
- sqsMessageRemover
- StartAsyncOperations
- SyncGranule
- TeaCache
- UpdateCmrAccessConstraints

### Example

```tf
lambda_timeouts = {
  sqsMessageRemover = 300
}
```

## lambda_memory_sizes

A configurable map of memory sizes (in MBs) for cumulus ingest module task lambdas in the form:

```hcl
<lambda_identifier>_memory_size: <memory_size>
  type = map(string)
```

Currently the following values are supported:

- AddMissingFileChecksums
- bulkOperation
- cleanExecutions
- CreateReconciliationReport
- CustomBootstrap
- DiscoverGranules
- DiscoverPdrs
- FakeProcessing
- fallbackConsumer
- FilesToGranules
- HelloWorld
- HyraxMetadataUpdates
- IndexFromDatabase
- KinesisInboundEventLogger
- KinesisOutboundEventLogger
- LzardsBackup
- manualConsumer
- messageConsumer
- MoveGranules
- OrcaCopyToArchiveAdapter
- OrcaRecoveryAdapter
- ParsePdr
- PdrStatusCheck
- PostToCmr
- processDeadLetterArchive
- ProvisionPostgresDatabase
- QueueGranules
- QueuePdrs
- QueueWorkflow
- replaySqsMessages
- s3-credentials-endpoint
- ScheduleSF
- SendPan
- sfEventSqsToDbRecords
- sfSemaphoreDown
- SfSqsReport
- sqs2sf
- sqs2sfThrottle
- sqsMessageConsumer
- sqsMessageRemover
- StartAsyncOperation
- SyncGranule
- TeaCache
- UpdateCmrAccessConstraints
- UpdateGranuleCmrMetadataFileLinks
- writeDbRecordsDLQtoS3

### Example

```tf
lambda_memory_sizes = {
  SyncGranule = 1036
}
```
