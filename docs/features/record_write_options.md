---
id: record_write_options
title: Options for writing records to Cumulus datastore during workflow executions
hide_title: false
---

Cumulus, by default, will write records involved in a workflow execution to the Cumulus datastore at several points during the execution. The records written include granules, pdrs, and executions, and these are stored in the Cumulus database when an execution's status changes to "running", "completed", or "failed".

For example, when a workflow is successfully triggered, records will be written to the datastore when that execution starts. This will include a granule record in its initial "running" state:

```json
{
  "granuleId": "L2_HR_PIXC_A_zHGdMM",
  "producerGranuleId": "L2_HR_PIXC_A",
  "status": "running",
}
```

:::note
This is an API-formatted granule. Granule records in the Postgres datastore will have different formatting.
:::

As the workflow progresses, this granule will be updated with `status: 'completed'` or `status: 'failed'` as appropriate.

## Skipping record writes

If desired, workflows can be configured to write only specified record types when a specified status is reached. For example, an `IngestAndPublishGranule` workflow configured with the following options in the `sf_event_sqs_to_db_record_types` block will only write `execution` and `pdr` records in the `running` status. This configuration has the effect of skipping `granule` database writes when the execution reaches the `running` status. Subsequent write requests for `granules` in the `completed` or `failed` status will write as normal.

```js
{
    sf_event_sqs_to_db_records_types = {
        IngestAndPublishGranule = {
            running = ["execution", "pdr"]
        }
    }
}
```

:::note
See the `sf_event_sqs_to_db_records_types` definition in [the terraform variable definitions](https://github.com/nasa/cumulus/blob/master/tf-modules/ingest/variables.tf) for a complete list of the possible record types and states.
:::
