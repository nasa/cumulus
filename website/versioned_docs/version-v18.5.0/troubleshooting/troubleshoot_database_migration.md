---
id: troubleshooting-database-migrations
title: Troubleshooting Database Migrations
hide_title: false
---

This document provides guidance on how to troubleshoot database migration when upgrading to v18.5.1.

:::info

This document is specifically intended to provide a potential resolution for issues with the database migration to v18.5.1+.
The advice in this document may be used for migrations to other versions, but please be mindful they may not provide the same resolution.
:::

## Failing Database Migrations

When trying to deploy the v18.5.1 of Cumulus, specifically the `data-persistence-tf` module, there is a chance the terraform deployment task times out. The timeout usually occurs when the `<prefix>-postgres-db-migration` lambda is invoked. It will attempt to run the migrations, which may take longer than the Lambda's timeout allows. This occurs when the lambda is trying to run a new migration that has not already been applied (e.g. is NOT in the PostgreSQL `Migrations Table`).

### Discerning Failing Migrations

The issue can be resolved by simply skipping the offending migration. To see which migration that is; you can query the PostgreSQL `knex_migrations` table and compare them to the ones you should have in your release (in this case 18.5.1). If one or more migrations is missing, that migration is potentially taking too long for the Lambda and causing issues.

### Next Steps

When you discover which migration(s) are missing from the `Migrations Table`. These steps can be taken to resolve:
    - Manually apply the migration (ex. `update_executions_deletion_constraint`) using SQL applied directly to your database. The SQL commands can be found in the `db` package of the Cumulus codebase
    - Manually add the entry into the `knex_migrations` table. Subsequent runs of the `<prefix>-postgres-db-migration` Lambda will check this table and skip any migrations listed. This means that your manual SQL updates will be respected and the Lambda will not try to process the same migration.
    - Re-deploy `data-persistence-tf` after verifying the above successfully completed

### Other potential issues

Migration Lambda timeouts (or other related timeouts) may be caused by `VACUUM` statements in the migration. If you find your deployment not completing despite the migration table and the migrations being consistent, this may be the issue. In v18.5.2, some `VACUUM` statements have been removed to tailor for this issue. If you find yourself struggling with v18.5.1 despite completing the above steps, plese upgrade to v18.5.2 and try for this issue. If you find yourself struggling with v18.5.1 despite completing the above steps, plese upgrade to v18.5.2 and try deployment again. The removal of potentially long-running migrations may resolve the issue.

### Miscellaneous

If the instructions in this document are not helping you with your issues(s) reagarding troubleshooting database migration, please contact the Cumulus Team for support.
