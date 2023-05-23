---
id: rds-phase-3-data-migration-guidance
title: Data Integrity & Migration Guidance (RDS Phase 3 Upgrade)
hide_title: false
---

A few issues were identied as part of the RDS Phase 2 release. These issues could impact Granule data-integrity and are described below along with recommended actions and guidance going forward.

## Issue Descriptions

### Issue 1:

https://bugs.earthdata.nasa.gov/browse/CUMULUS-3019

Ingesting granules will delete unrelated files from the Files Postgres table. This is due to an issue in our logic to remove excess files when writing granules and fixed in Cumulus versions 13.2.1, 12.0.2, 11.1.5

With this bug we believe the data in Dynamo is the most reliable and Postgres is out-of-sync.

### Issue 2:

https://bugs.earthdata.nasa.gov/browse/CUMULUS-3024

Updating an existing granule either via API or Workflow could result in datastores becoming out-of-sync if a partial granule record is provided. Our update logic operates differently in Postgres and Dynamo/Elastic. If a partial object is provided in an update payload the Postgres record will delete/nullify fields not present in the payload. Dynamo/Elastic will retain existing values and not delete/nullify.

With this bug it’s possible that either Dynamo or PG could be the source of truth. It’s likely that it’s still Dynamo.

### Issue 3:

### https://bugs.earthdata.nasa.gov/browse/CUMULUS-3024

Updating an existing granule with an empty files array in the update payload results in datastores becoming out-of-sync. If an empty array is provided, existing files in Dynamo and Elastic will be removed. Existing files in Postgres will be retained.

With this bug Postgres is the source of truth. Files are retained in PG and incorrectly removed in Dynamo/Elastic.

### Issue 4:

https://bugs.earthdata.nasa.gov/browse/CUMULUS-3017

Updating/putting a granule via framework writes that duplicates a granuleId but has a different collection results in overwrite of the DynamoDB granule but a *new* granule record for Postgres.  This *intended* post RDS transition, however should not be happening now.

With this bug we believe Dynamo is the source of truth, and ‘excess’ older granules will be left in postgres.     This should be detectable with tooling/query to detect duplicate granuleIds in the granules table.

### Issue 5:

https://bugs.earthdata.nasa.gov/browse/CUMULUS-3024

This is a sub-issue of issue 2 above - due to the way we assign a PDR name to a record, if the `pdr` field is missing from the final payload for a granule as part of a workflow message write, the final granule record will not link the PDR to the granule properly in postgres, however the dynamo record *will* have the linked PDR.       This *can* happen in situations where the granule is written prior to completion with the PDR in the payload, but then downstream only the granule object is included, particularly in multi-workflow ingest scenarios and/or bulk update situations.


## Immediate Actions

1. Re-review the issues described above
    - GHRC was able to scope the affected granules to specific collections, which makes the recovery process much easier. This may not be an option for all DAACs.

2. If you have not ingested granules or performed partial granule updates on affected Cumulus versions (questions 1 and 2 on the survey), no action is required. You may update to the latest version of Cumulus.

3. One option to ensure your Postgres data matches Dynamo is running the data-migration lambda (see below for instructions) before updating to the latest Cumulus version if both of the following are true:
    - you have ingested granules using an affected Cumulus version
    - your DAAC has not had any operations that updated an existing granule with an empty files array (granule.files = [])

4. A second option for DAACs that have ingested data using an affected Cumulus version is to use your DAAC’s recovery tools or reingest the affected granules. This is likely the most certain method for ensuring Postgres contains the correct data but may be infeasible depending on the size of data holdings, etc..

## Guidance Going Forward

1. Before updating to Cumulus version 16.x and beyond, take a snapshot of your DynamoDB instance. The v16 update removes the DynamoDB tables. This snapshot would be for use in unexpected data recovery scenarios only.

2. Cumulus recommends that you regularly backup your Cumulus RDS database. The frequency will depend on each DAAC’s comfort level, datastore size, and time available but we recommend regular backups. https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateSnapshot.html

3. Invest future development effort in data validation/integrity tools and procedures. Each DAAC has different requirements here. Each DAAC should maintain procedures for validating their Cumulus datastore against their holdings.

## Running a Granule Migration

[Instructions for running the data-migration operation to sync Granules from DynamoDB to PostgreSQL](./upgrade-rds.md#5-run-the-second-data-migration)

The data-migration2 Lambda (which is invoked asynchronously using `${PREFIX}-postgres-migration-async-operation)` uses Cumulus' Granule upsert logic to write granules from DynamoDB to PostgreSQL. This is particularly notable because granules with a running or queued status will only migrate a subset of their fields:

- status
- timestamp
- updated_at
- created_at

It is recommended that users ensure their granules are in the correct state before running this data migration. If there are Granules with an incorrect status, it will impact the data migration.

For example, if a Granule in the running status is updated by a workflow or API call (containing an updated status) and fails, that granule will have the original running status, not the intended/updated status. Failed Granule writes/updates should be evaluated and resolved prior to this data migration.

Cumulus provides the Cumulus Dead Letter Archive which is populated by the Dead Letter Queue for the sfEventSqsToDbRecords Lambda, which is responsible for Cumulus message writes to PostgreSQL. This may not catch all write failures depending on where the failure happened and workflow configuration but may be a useful tool.

If a Granule record is correct except for the status, Cumulus provides an API to update specific granule fields.
