---
id: upgrade-rds-phase-3-release
title: Upgrade RDS Phase 3 Release
hide_title: false
---

## Background

Release v16 of Cumulus Core includes an update to remove the now-unneeded AWS DynamoDB tables for the primary archive, as this datastore has been fully migrated to PostgreSQL databases in prior releases, and should have been operating in a parallel write mode to allow for repair/remediation of prior issues.

## Requirements

To update to this release (and beyond) users must:

- Have deployed a release of at least version 11.0.0 (preferably at least the latest supported minor version in the 11.1.x release series), having successfully completed the transition to using PostgreSQL as the primary datastore in release 11
- Completed evaluation of the primary datastore for data irregularities that might be resolved by re-migration of data from the DynamoDB datastores.
- Review the CHANGELOG for any migration instructions/changes between (and including) this release and the release you're upgrading from.
  **Complete migration instructions from the previous release series should be included in release notes/CHANGELOG for this release**, this document notes migration instructions specifically for release 16.0.0+, and is not all-inclusive if upgrading from multiple prior release versions.
- Configure your deployment terraform environment to utilize the new release, noting all migration instructions.
- The PostgreSQL database cluster should be updated to the supported version (Aurora Postgres 11.13+ compatible)

## Suggested Prerequisites

In addition to the above requirements, we suggest users:

- Retain a backup of the primary DynamoDB datastore in case of recovery/integrity concerns exist between DynamoDB and PostgreSQL.

   This should only be considered if remediation/re-migration from DynamoDB has recently occurred, specifically due to the issues reported in the following tickets:

  - CUMULUS-3019
  - CUMULUS-3024
  - CUMULUS-3017

  and other efforts included in the outcome from CUMULUS-3035/CUMULUS-3071.

- Halt all ingest prior to performing the version upgrade.
- Run load testing/functional testing.

  While the majority of the modifications for release 16 are related to DynamoDB removal, we always encourage user engineering teams ensure compatibility at scale with their deployment's configuration prior to promotion to a production environment to ensure a smooth upgrade.

## Upgrade procedure

### 1. (Optional) Halt ingest

  If ingest is not halted, once the `data-persistence` module is deployed but the main Core module is not deployed, existing database writes will fail, resulting in in-flight workflow messages failing to the message [Dead Letter Archive](https://nasa.github.io/cumulus/docs/features/dead_letter_archive), and all API write related calls failing.

  While this is optional, it is *highly encouraged*, as cleanup could be significant.

### 2. Deploy the data persistence module

  Ensure your source for the data-persistence module is set to the release version (substituting v16.0.0 for the latest v16 release):

  ```tf
    source = "https://github.com/nasa/cumulus/releases/download/v16.0.0/terraform-aws-cumulus.zip//tf-modules/data-persistence"
  ```

  Run `terraform init` to bring all updated source modules, then run `terraform apply` and evaluate the changeset before proceeding.   The changeset should include blocks like the following for each table removed:

  ```text
  # module.data_persistence.aws_dynamodb_table.collections_table will be destroyed
  # module.data_persistence.aws_dynamodb_table.executions_table will be destroyed
  # module.data_persistence.aws_dynamodb_table.files_table will be destroyed
  # module.data_persistence.aws_dynamodb_table.granules_table will be destroyed
  # module.data_persistence.aws_dynamodb_table.pdrs_table will be destroyed
  ```

  In addition, you should expect to see the outputs from the module remove the references to the DynamoDB tables:

  ```text
  Changes to Outputs:
  ~ dynamo_tables = {
        access_tokens          = {
            arn  = "arn:aws:dynamodb:us-east-1:XXXXXX:table/prefix-AccessTokensTable"
            name = "prefix-AccessTokensTable"
        }
        async_operations       = {
            arn  = "arn:aws:dynamodb:us-east-1:XXXXXX:table/prefix-AsyncOperationsTable"
            name = "prefix-AsyncOperationsTable"
        }
      - collections            = {
          - arn  = "arn:aws:dynamodb:us-east-1:XXXXXX:table/prefix-CollectionsTable"
          - name = "prefix-CollectionsTable"
        } -> null
      - executions             = {
          - arn  = "arn:aws:dynamodb:us-east-1:XXXXXX:table/prefix-ExecutionsTable"
          - name = "prefix-ExecutionsTable"
        } -> null
      - files                  = {
          - arn  = "arn:aws:dynamodb:us-east-1:XXXXXX:table/prefix-FilesTable"
          - name = "prefix-FilesTable"
        } -> null
      - granules               = {
          - arn  = "arn:aws:dynamodb:us-east-1:XXXXXX:table/prefix-GranulesTable"
          - name = "prefix-GranulesTable"
        } -> null
      - pdrs                   = {
          - arn  = "arn:aws:dynamodb:us-east-1:XXXXXX:table/prefix-PdrsTable"
          - name = "prefix-PdrsTable"
        } -> null
```

  Once this completes successfully, proceed to the next step.

### Deploy cumulus-tf module

  Ensure your source for the data-persistence module is set to the release version (substituting v16.0.0 for the latest v16 release):

  ```tf
  source = "https://github.com/nasa/cumulus/releases/download/v16.0.0/terraform-aws-cumulus.zip//tf-modules/cumulus"
  ```

  You should expect to see a significant changeset in Core provided resources, in addition to the following resources being destroyed from the RDS Phase 3 update set:

  ```text
  # module.cumulus.module.archive.aws_cloudwatch_log_group.granule_files_cache_updater_logs will be destroyed
  # module.cumulus.module.archive.aws_iam_role.granule_files_cache_updater_lambda_role will be destroyed
  # module.cumulus.module.archive.aws_iam_role.migration_processing will be destroyed
  # module.cumulus.module.archive.aws_iam_role_policy.granule_files_cache_updater_lambda_role_policy will be destroyed
  # module.cumulus.module.archive.aws_iam_role_policy.migration_processing will be destroyed
  # module.cumulus.module.archive.aws_iam_role_policy.process_dead_letter_archive_role_policy will be destroyed
  # module.cumulus.module.archive.aws_iam_role_policy.publish_collections_lambda_role_policy will be destroyed
  # module.cumulus.module.archive.aws_iam_role_policy.publish_executions_lambda_role_policy will be destroyed
  # module.cumulus.module.archive.aws_iam_role_policy.publish_granules_lambda_role_policy will be destroyed
  # module.cumulus.module.archive.aws_lambda_event_source_mapping.granule_files_cache_updater will be destroyed
  # module.cumulus.module.archive.aws_lambda_event_source_mapping.publish_pdrs will be destroyed
  # module.cumulus.module.archive.aws_lambda_function.execute_migrations will be destroyed
  # module.cumulus.module.archive.aws_lambda_function.granule_files_cache_updater will be destroyed
  # module.cumulus.module.data_migration2.aws_iam_role.data_migration2 will be destroyed
  # module.cumulus.module.data_migration2.aws_iam_role_policy.data_migration2 will be destroyed
  # module.cumulus.module.data_migration2.aws_lambda_function.data_migration2 will be destroyed
  # module.cumulus.module.data_migration2.aws_security_group.data_migration2[0] will be destroyed
  # module.cumulus.module.postgres_migration_async_operation.aws_iam_role.postgres_migration_async_operation_role will be destroyed
  # module.cumulus.module.postgres_migration_async_operation.aws_iam_role_policy.postgres_migration_async_operation will be destroyed
  # module.cumulus.module.postgres_migration_async_operation.aws_lambda_function.postgres-migration-async-operation will be destroyed
  # module.cumulus.module.postgres_migration_async_operation.aws_security_group.postgres_migration_async_operation[0] will be destroyed
  # module.cumulus.module.postgres_migration_count_tool.aws_iam_role.postgres_migration_count_role will be destroyed
  # module.cumulus.module.postgres_migration_count_tool.aws_iam_role_policy.postgres_migration_count will be destroyed
  # module.cumulus.module.postgres_migration_count_tool.aws_lambda_function.postgres_migration_count_tool will be destroyed
  # module.cumulus.module.postgres_migration_count_tool.aws_security_group.postgres_migration_count[0] will be destroyed
  ```

#### Possible deployment issues

##### Security group deletion

  The following security group resources will be deleted as part of this update:

  ```text
  module.cumulus.module.data_migration2.aws_security_group.data_migration2[0]
  module.cumulus.module.postgres_migration_count_tool.aws_security_group.postgres_migration_count[0]
  module.cumulus.module.postgres_migration_async_operation.aws_security_group.postgres_migration_async_operation[0]
  ```

  Because the AWS resources associated with these security groups can take some time to be properly updated (in testing this was 20-35 minutes), these deletions may cause the deployment to take some time.   If for some unexpected reason this takes longer than expected and this causes the update to time out, you should be able to continue the deployment by re-running terraform to completion.

  Users may also opt to attempt to reassign the affected Network Interfaces from the Security Group/deleting the security group manually if this situation occurs and the deployment time is not desirable.
