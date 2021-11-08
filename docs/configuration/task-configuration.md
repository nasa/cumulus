---
id: task-configuration
title: Configuration of Tasks
hide_title: false
---

The `cumulus` module exposes values for configuration for some of the provided archive and ingest tasks.   Currently the following are available as configurable variables:

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
