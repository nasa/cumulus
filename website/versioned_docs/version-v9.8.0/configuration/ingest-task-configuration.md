---
id: version-v9.8.0-ingest-task-configuration
title: Configuration of Ingest Tasks
hide_title: false
original_id: ingest-task-configuration
---

The `cumulus` module exposes values for configuration of some of the provided ingest workflow tasks.   Currently the following are available as configurable variables:

## lambda_timeouts

A configurable map of timeouts (in seconds) for cumulus ingest module task lambdas in the form:

```text
<lambda_identifier>_timeout: <timeout>"
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
{ "discover_granules_task_timeout": 300 }
```
