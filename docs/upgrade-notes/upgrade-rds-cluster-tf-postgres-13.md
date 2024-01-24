---
id: upgrade-rds-cluster-tf-postgres-13
title: Upgrade Database Cluster to PostgreSQL v13
hide_title: false
---

Cumulus Core as of version > 18.1.0, and for the stable support release 16.1.x *only* for versions > v16.1.3 now supports and is tested against Aurora Postgres v13.   All users should update their datastores to this version as part of an upgrade process upon upgrading to release version 18.2.0 or 16.1.4.

We recommend stopping all ingest rules if database downtime is required (e.g. you do not have a blue-green database solution or are using serverless V1) for the update  as any unavailability of the database may result in unexpected database write failures (resulting in records in the Dead Letter Archive), workflow failures or other unexpected failures.

**It is also recommended that users test/evaluate the upgrade prior to performing it on their primary datastore in order to determine expected downtime and/or other related issues for their particular configuration.**

## Users utilizing the `cumulus-rds-tf` module

It is recommended that users manually backup and/or consider cloning their datastore in order to recover the datastore if an upgrade goes awry.

Upgrading the Aurora Serverless v1 cluster will be completed via AWS console in this document and require manual steps to complete the upgrade:

- Ensure a supported version (> 18.1.0 *or* 16.1.4 or a later patch version) is deployed.
- Deploy the newest version of the `cumulus-rds-tf` module, ensuring `enable_upgrade` is set to false.   This will *only* deploy a `v13` version of your current parameter group configuration, named `<prefix>-cluster-parameter-group-v13`.
- Shut down all ingest and other usage of the database cluster by 3rd party applications if appropriate.
- Once this is done, utilize the AWS RDS console to `modify` the database cluster, and update the following settings:
  - Set `Engine Version`  to the currently available Serverless v1 Postgres v13 engine (PostgreSQL 13.12 as of this instruction set’s authoring)
  - Ensure the min/max capacity settings match expected values and have not changed
  - DB cluster parameter group - utilize the newly created parameter group from step #2 for the update.
- Once you have completed the modifications, click `Continue` and verify the `Summary of modifications` has the engine version and modified parameter group.
- **Important:** Update the `Schedule modifications` to apply the change immediately.

    Once this is done, apply the updates. The database upgrade will begin, and the database will shutdown/restart repeatedly.    You can monitor progress in the database cluster’s `Logs & events` tab.

    Upon completion you should expect to see output similar to:

    ```text
    Database cluster engine major version has been upgraded.
    Updated to use DBClusterParameterGroup : <prefix>-cluster-parameter-group-v13. The DB cluster will scale to apply database parameters.
    Scaling DB cluster from 4 capacity units to 4 capacity units for this reason: Apply database parameters.
    ```

- On update completion, validate database cluster appears to have restarted with the expected configuration, non-cumulus databases, etc.
- Modify the `enable_upgrade` `rds-cluster-tf` module variable to `true`, and run `terraform plan` (and optionally apply) to ensure there are no changes in the module, and the postgres v11 compatible parameter group is cleaned up.
- Resume use of the database cluster.