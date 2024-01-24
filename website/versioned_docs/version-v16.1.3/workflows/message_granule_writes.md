---
id: message_granule_writes
title: Workflow Message Granule Writes
hide_title: false
---

## Overview

When an [AWS Step Function Event](https://docs.aws.amazon.com/step-functions/latest/dg/cw-events.html) occurs for a [Cumulus workflow](https://nasa.github.io/cumulus/docs/next/workflows/) *or* a write is attempted via the [sf-sqs-report task](https://github.com/nasa/cumulus/tree/master/tasks/sf-sqs-report) a message is dispatched to the `sfEventSqsToDbRecordsInputQueue` for processing.

Messages on the `sfEventSqsToDbRecordsInputQueue` (which correspond to lambda invocations or workflow events) are processed in batches of 10 and the `sfEventSqsToDbRecords` Lambda is triggered for each. The corresponding execution/PDR is attempted to write, then the granule records associated with the message are also attempted to be written.

For each granule in the batch of granules **one of the following** occurs:

- The granule is written successfully.
- The granule write is dropped, due to asynchronous write constraints.
- The lambda fails to write the granule in an unexpected way (e.g. lambda failure, AWS outage, etc).   In this case, the granule will become visible again after the `sfEventSqsToDbRecordsInputQueue` visibility timeout (currently set as a function of the rds_connection_timing_configuration terraform variable:

```terraform
var.rds_connection_timing_configuration.acquireTimeoutMillis / 1000) + 60
```

- The granule fails to write due to a schema violation, database connection issue or other expected/caught error.    The message is immediately written to the [Dead Letter Archive](https://nasa.github.io/cumulus/docs/features/dead_letter_archive/) for manual intervention/investigation.

### Caveats

- All non-bulk [Cumulus API](https://nasa.github.io/cumulus-api/) granule operations are *not* constrained by this logic and do not utilize the SQS update queue.  They are instead invoked synchronously and follow expected RESTful logic without any asynchronous write constraints *or* default message values.
- This information is correct as of release v16 of Cumulus Core.   Please review the [CHANGELOG](https://github.com/nasa/cumulus/blob/master/CHANGELOG.md) and migration instructions for updated features/changes/bugfixes.

## Granule Write Constraints

For each granule to be written, the following constraints apply:

- `granuleId` must be unique.

  Granule write will not be allowed if `granuleId` already exists in the database for another collection, granules in this state will be rejected to write and wind up in the [Dead Letter Archive](https://nasa.github.io/cumulus/docs/features/dead_letter_archive/)

- Message granule must match the [API Granule schema](https://github.com/nasa/cumulus/blob/master/packages/api/lib/schemas.js).

  If not the write will be rejected, the granule status will be updated to `failed`, and the message will wind up in the [Dead Letter Archive](https://nasa.github.io/cumulus/docs/features/dead_letter_archive/)

- If the granule is being updated to a `running`/`queued` status:
  - Only `status`, `timestamp`, `updated_at` and `created_at` are updated.   All other values are retained as they currently exist in the database.
  - The write will only be allowed if the following are true, else the write request will be ignored as out-of-order/stale:
    - The granule createdAt value is newer or the same as the existing record.
    - If the granule is being updated to `running`, the execution the granule is being associated with doesn’t already exist in the following states: `completed`, `failed`.
    - If the granule is being updated to `queued`, the execution the granule is being associated with does not exist in any state in the database.

- If the granule is being updated to a failed/completed state:
  - All fields provided will override existing values in the database, if any.
  - The write will only be allowed if the following are true, else the write request will be ignored as out-of-order/stale:
    - The granule createdAt value is newer or the same as the existing record.

## Message Granule Write Behavior

The granule object values are set based on the incoming Cumulus Message values (unless otherwise specified the *message* values overwrite the granule payload values):

| Column      | Value |
| ----------- | ----------- |
| collection | Derived from meta.collection.name and meta.collection.version |
| createdAt | Defaults to `cumulus_meta.workflow_start_time`, else `payload.granule.createdAt` |
| duration | Calculated based on the delta between `cumulus_meta.workflow_start_time` and when the database message writes |
| error | Object taken directly from the `message.error` object |
| execution  | Derived from `cumulus_meta.state_machine` and `cumulus_meta.execution_name` |
| files | Taken directly from `payload.granule.files`.   If files is `null`, set it to an empty list `[]` |
| pdrName | Taken directly from payload.pdr.name |
| processingEndDateTime | Derived from AWS API interrogation (`sfn().describeExecution`)  based on `execution` value |
| processingStartDateTime | Derived from AWS API interrogation (`sfn().describeExecution`)  based on `execution` value |
| productVolume | Sums the values of the passed in `payload.granules.files.size`.   Does not validate against S3 |
| provider | Inferred from `meta.provider` value in cumulus message |
| published | Taken directly from `granule.published`, if not specified or null is specified, defaults to `false` |
| queryFields | Object taken directly from meta.granule.queryFields |
| status | Taken directly from `meta.status` |
| status | Uses `meta.status` if provided, else `payload.granule.status` |
| timeStamp | Set to the date-time value for the `sfEventSqsToDbRecords` invocation |
| timeToArchive | Taken from `payload.granule.post_to_cmr_duration`/1000, provided by Core task or user task.  Value will be set to zero if no value set |
| timeToPreprocess | `payload.granule.sync_granule_duration`, provided by core or user task. Will set to 0 if value is not set |
| updatedAt | Set to the date-time value for the `sfEventSqsToDbRecords` invocation |
| beginningDateTime | See: CMR Temporal Values section below |
| endingDateTime | See: CMR Temporal Values section below |
| productionDateTime | See: CMR Temporal Values section below |
| lastUpdateDateTime | See: CMR Temporal Values section below |

### CMR Temporal Values

The following fields are generated based on values in the associated granule CMR file, if available:

- beginningDateTime
  - If there is a beginning and end DateTime:

    - UMMG: `TemporalExtent.RangeDateTime.BeginningDateTime`
    - ISO: `gmd:MD_DataIdentification.gmd:extent.gmd:EX_Extent.gmd:temporalElement.gmd:EX_TemporalExtent.gmd:extent.gml:TimePeriod:gml:beginPosition`
  - If not:
    - UMMG: `TemporalExtent.SingleDateTime`
    - ISO: `gmd:MD_DataIdentification.gmd:extent.gmd:EX_Extent.gmd:temporalElement.gmd:EX_TemporalExtent.gmd:extent.gml:TimeInstant.gml:timePosition`

- endingDateTime
  - If there is a beginning and end DateTime:

    - UMMG: `TemporalExtent.RangeDateTime.BeginningDateTime`
    - ISO: `gmd:MD_DataIdentification.gmd:extent.gmd:EX_Extent.gmd:temporalElement.gmd:EX_TemporalExtent.gmd:extent.gml:TimePeriod:gml:beginPosition`
  - If not:
    - UMMG: `TemporalExtent.SingleDateTime`
    - ISO: `gmd:MD_DataIdentification.gmd:extent.gmd:EX_Extent.gmd:temporalElement.gmd:EX_TemporalExtent.gmd:extent.gml:TimeInstant.gml:timePosition`

- productionDateTime
  - UMMG: `DataGranule.ProductionDateTime`
  - ISO: `gmd:identificationInfo:gmd:dataQualityInfo.gmd:DQ_DataQuality.gmd:lineage.gmd:LI_Lineage.gmd:processStep.gmi:LE_ProcessStep.gmd:dateTime.gco:DateTime`

- lastUpdateDateTime
  - UMMG:

  Given DataGranule.ProductionDateTime values where Type is in `Update`, `Insert`, `Create` , select most recent value.

  - ISO: Given a node matching `gmd:MD_DataIdentification.gmd:citation.gmd:CI_Citation.gmd:title.gco:CharacterString` === `UpdateTime`, use `gmd:identificationInfo:gmd:MD_DataIdentification.gmd:citation.gmd:CI_Citation.gmd:date.gmd:CI_Date.gmd:date.gco:DateTime`
