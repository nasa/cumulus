---
id: upgrade-rds-cluster-tf-postgres-17
title: Upgrade Database Cluster to PostgreSQL v17
hide_title: false
---

Cumulus Core as of version **>= 20.2.0** now supports and is tested against Aurora Postgres v17. All users should update their datastores to this version as part of an upgrade process upon upgrading to release version 20.2.0.

We recommend stopping all ingest rules if database downtime is required (e.g. you do not have a blue-green database solution or are using serverless V2) for the update  as any unavailability of the database may result in unexpected database write failures (resulting in records in the Dead Letter Archive), workflow failures or other unexpected failures.

**It is also recommended that users test/evaluate the upgrade prior to performing it on their primary datastore in order to determine expected downtime and/or other related issues for their particular configuration.**

## Users utilizing the `cumulus-rds-tf` module

It is recommended that users manually backup and/or consider cloning their datastore in order to recover the datastore if an upgrade goes awry.

Upgrading the Aurora Serverless v2 cluster will be completed via AWS console in this document and require manual steps to complete the upgrade. The AWS RDS for PostgreSQL upgrade document may be used as a reference:
<https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.PostgreSQL.MajorVersion.html>

- Ensure a supported version (> 20.1.2 a later patch version) is deployed.
- Deploy the newest version of the `cumulus-rds-tf` module, ensuring `enable_upgrade` is set to false.   This will *only* deploy a `v17` version of your current parameter group configuration, named `<prefix>-cluster-parameter-group-v17`.
- Shut down all ingest and other usage of the database cluster by 3rd party applications if appropriate.
- Once this is done, utilize the AWS RDS console to `modify` the database cluster, and update the following settings:
  - Set `Engine Version` to the currently available Serverless v2 Postgres v17 engine (PostgreSQL 17.4 as of this instruction set’s authoring)
  - Ensure the min/max capacity settings match expected values and have not changed
  - DB cluster parameter group - utilize the newly created parameter group from step #2 for the update.
- Once you have completed the modifications, click `Continue` and verify the `Summary of modifications` has the engine version and modified parameter group.
- **Important:** Update the `Schedule modifications` to apply the change immediately.

    Once this is done, apply the updates. The database upgrade will begin, and the database will shutdown/restart repeatedly. You can monitor progress in the database cluster’s `Logs & events` tab.

    Upon completion, you should expect to see output similar to:

    ```text
    Database cluster engine major version has been upgraded.
    Updated to use DBClusterParameterGroup : <prefix>-cluster-parameter-group-v17.
    ```

- On update completion, validate database cluster appears to have restarted with the expected configuration, non-cumulus databases, etc.
- Update the `enable_upgrade` `rds-cluster-tf` module variable to `true`, and run `terraform init` and `terraform apply` to ensure the postgres v13 compatible parameter group is cleaned up. This should be the only change so double-check the changeset or run `terraform plan` to be sure.
- Resume use of the database cluster.
