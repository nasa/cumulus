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

- add_missing_file_checksums_task_timeout
- archive_api_timeout
- bulk_operation_timeout
- clean_executions_timeout
- cnm_response_task_timeout
- cnm_to_cnma_task_timeout
- create_reconciliation_report_timeout
- custom_bootstrap_timeout
- distribution_api_timeout
- db_migration_timeout
- discover_granules_task_timeout
- discover_pdrs_task_timeout
- fake_processing_task_timeout
- fallback_consumer_timeout
- files_to_granules_task_timeout
- hello_world_task_timeout
- hyrax_metadata_update_tasks_timeout
- index_from_database_timeout
- kinesis_inbound_event_logger_timeout
- kinesis_outbound_event_logger_timeout
- lzards_api_client_test_timeout
- lzards_backup_task_timeout
- manual_consumer_timeout
- message_consumer_timeout
- move_granules_task_timeout
- parse_pdr_task_timeout
- pdr_status_check_task_timeout
- private_api_timeout
- process_dead_letter_archive_timeout
- provision_database_timeout
- post_to_cmr_task_timeout
- python_references_task_timeout
- replay_sqs_messages_timeout
- queue_granules_task_timeout
- queue_pdrs_task_timeout
- queue_workflow_task_timeout
- s3_credentials_timeout
- schedule_sf_timeout
- sf_semaphore_down_timeout
- sf_sqs_report_task_timeout
- start_async_operation_timeout
- sqs_message_consumer_timeout
- sqs_message_remover_timeout
- sqs2sfThrottle_timeout
- sync_granule_task_timeout
- tea_cache_timeout
- update_granules_cmr_metadata_file_links_task_timeout

### Example

```tf
lambda_timeouts = {
  discover_granules_task_timeout = 300
}
```

## lambda_memory_sizes

A configurable map of memory sizes (in MBs) for cumulus ingest module task lambdas in the form:

```hcl
<lambda_identifier>_memory_size: <memory_size>
  type = map(string)
```

Currently the following values are supported:

- add_missing_file_checksums_task_memory_size
- bulk_operation_memory_size
- clean_executions_memory_size
- cnm_responses_task_memory_size
- cnm_to_cma_task_memory_size
- create_reconciliation_report_memory_size
- custom_bootstrap_memory_size
- db_migration_memory_size
- discover_granules_task_memory_size
- discover_pdrs_task_memory_size
- fake_processing_task_memory_size
- fallback_consumer_memory_size
- hyrax_metadata_updates_task_memory_size
- index_from_database_memory_size
- kinesis_inbound_event_logger_memory_size
- kinesis_outbound_event_logger_memory_size
- lzards_api_client_test_memory_size
- lzards_backup_task_memory_size
- manual_consumer_memory_size
- message_consumer_memory_size
- move_granules_task_memory_size
- parse_pdr_task_memory_size
- pdr_status_check_task_memory_size
- process_dead_letter_archive_memory_size
- provision_database_memory_size
- post_to_cmr_task_memory_size
- python_reference_task_memory_size
- replay_sqs_messages_memory_size
- queue_granules_task_memory_size
- queue_pdrs_task_memory_size
- queue_workflow_task_memory_size
- s3_credentials_memory_size
- schedule_sf_memory_size
- sf_semaphore_down_memory_size
- sf_sqs_report_task_memory_size
- sf_event_sqs_to_db_records_memory_size
- start_async_operation_memory_size
- sqs2sf_memory_size
- sqs2sfThrottle_memory_size
- sqs_message_consumer_memory_size
- sqs_message_remover_memory_size
- sync_granule_task_memory_size
- tea_cache_memory_size
- update_cmr_acess_constraints_task_memory_size
- update_granules_cmr_metadata_file_links_task_memory_size
- write_db_dlq_records_to_s3_memory_size

### Example

```tf
lambda_memory_sizes = {
  queue_granules_task_memory_size = 1036
}
```
