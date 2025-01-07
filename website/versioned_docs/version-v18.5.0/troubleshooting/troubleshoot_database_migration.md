---
id: troubleshooting-database-migrations
title: Troubleshooting Database Migrations
hide_title: false
---

This document provides guidance on how to troubleshoot database migration when trying to upgrade to v18.5.1.

:::info

This document is specifically intended to provide a potential resolution for issues with the database migration to v18.5.1+.
The advice in this document may be used for migrations to other versions, but please be mindful they may not provide the same resolution.
:::

## Failing Database Migrations

When trying to deploy the v18.5.1 of Cumulus, specifically the `data-persistence-tf` module, there is a chance the terraform deployment task times out. The timeout usually occurs when the `<prefix>-postgres-db-migration` lambda is invoked. It will attempt to run the migrations, but the lambda reports that the table is locked. This occurs when the lambda is trying to run a migration that is NOT in the `Migrations Table`.

### Discerning Failing Migrations

The issue can be resolved by simply skipping the offending migration. To see which migration that is; you can query the `knex_migrations` table and compare them to the ones you should have in your release (in this case 18.5.1). If one or more migrations is missing, that explains the issue.

### Next Steps

When you discover which migration(s) are missing from the `Migrations Table`. These steps can be taken to resolve:
    - Manually apply the migration (ex. `update_executions_deletion_constraint`), the SQL commands can be found in the `db` package of the Cumulus codebase
    - Manually add the entry into the `knex_migrations` table (this will skip the lambda's migration since it has been done manually)
    - Re-deploy `data-persistence-tf` after verifying the above successfully completed

### Other potential issues

If you are having other issues related or unrelated to a missing migration, it may be related to the `VACUUM` statements in the migration. When migration is
already ran manually (like what was mentioned above), the `VACUUM` has potential to cause performance concerns and may not even complete (since it would be redundant). If you find your
deployment not completing despite the migration table and the migrations being consistent, this may be the issue. In v18.5.2, some `VACUUM` statements have been removed to tailor
for this issue. If you find yourself struggling with v18.5.1 despite completing the above steps, plese upgrade to v18.5.2 and try as well.

### Miscellaneous

If the instructions in this document are not helping you with your issues(s) reagarding troubleshooting database migration, please contact the Cumulus Team for support.
