---
id: data_migrations_rds
title: Running data migrations for RDS
hide_title: false
---

## Background

This release of Cumulus (x.x.x) integrates with RDS and creates a new PostgreSQL database for archiving Cumulus data (e.g. granules, files, executions).

While eventually Cumulus will only support using RDS as its data archive, for now the system will do **parallel writes** to both DynamoDB and PostgreSQL so that all new data is archived in both datastores.

However, in order to copy all of your previously written data from DynamoDB to PostgreSQL, you will need to run data migration scripts that we have provided and which this document will explain how to use.

## Upgrade steps

Follow the steps outlined below in precisely this order to upgrade your deployment and run the data migrations.

### Deploy a new RDS cluster

See the docs on [how to deploy a new RDS cluster](./../deployment/postgres-database-deployment.md).

### Deploy your data-persistence module

You will need to update your data-persistence module to include some new variables related to RDS. See the configuration in our template-deploy repo for reference: <https://github.com/nasa/cumulus-template-deploy/tree/master/data-persistence-tf>

Then you can re-deploy your data-persistence module as usual:

```bash
terraform apply
```

### Deploy and run data-migration1

### Deploy cumulus module

### Run data-migration2

### Run reconciliation tool?
