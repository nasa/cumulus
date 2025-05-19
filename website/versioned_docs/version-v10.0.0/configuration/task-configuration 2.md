---
id: version-v10.0.0-task-configuration
title: Configuration of Tasks
hide_title: false
original_id: task-configuration
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

- discover_granules_task_timeout
- discover_pdrs_task_timeout
- hyrax_metadata_update_tasks_timeout
- lzards_backup_task_timeout
- move_granules_task_timeout
- parse_pdr_task_timeout
- pdr_status_check_task_timeout
- post_to_cmr_task_timeout
- queue_granules_task_timeout
- queue_pdrs_task_timeout
- queue_workflow_task_timeout
- sync_granule_task_timeout
- update_granules_cmr_metadata_file_links_task_timeout

### Example

```tf
lambda_timeouts = {
  discover_granules_task_timeout = 300
}
```
