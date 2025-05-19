---
id: version-v1.16.0-data_in_dynamodb
title: Cumulus Metadata in DynamoDB
hide_title: true
original_id: data_in_dynamodb
---

# Cumulus Metadata in DynamoDB

* [DynamoDB Backup and Restore](#backup-and-restore-with-aws)
* [DynamoDB Auto Scaling](#dynamodb-auto-scaling)

[@cumulus/api](https://www.npmjs.com/package/@cumulus/api) uses a number of methods to preserve the metadata generated in a Cumulus instance.

All configurations and system-generated metadata is stored in DynamoDB tables except the logs. System logs are stored in the AWS CloudWatch service.

`@cumulus/api` uses the following DynamoDB tables:

* **Users:** api/dashboard users
* **Collections:** collection records
* **Providers:** provider records
* **Rules:** rules for managing and running workflows
* **Executions:** workflow executions (step function executions)
* **Granules:** granules processed by the Cumulus instance
* **PDRs:** PDRs processed in Cumulus

Amazon DynamoDB stores three geographically distributed replicas of each table to enable high availability and data durability. Amazon DynamoDB runs exclusively on solid-state drives (SSDs). SSDs help AWS achieve the design goals of predictable low-latency response times for storing and accessing data at any scale.

## Backup and Restore with AWS

You can enable point-in-time recovery (PITR) as well as create an on-demand backup for your Amazon DynamoDB tables.

PITR provides continuous backups of your DynamoDB table data. You can enable PITR with a single click from the AWS Management Console or a single API call. When enabled, DynamoDB maintains continuous backups of your table up to the last 35 days. You can recover a copy of that table to a previous state at any point in time from the moment you enable PITR, up to a maximum of the 35 preceding days. PITR provides continuous backups until you explicitly disable it.

On-demand backups allow you to create backups of DynamoDB table data and its settings. You can initiate an on-demand backup at any time with a single click from the AWS Management Console or a single API call. You can restore the backups to a new DynamoDB table in the same AWS Region at any time.

PITR gives your DynamoDB tables continuous protection from accidental writes and deletes. With PITR, you do not have to worry about creating, maintaining, or scheduling backups. You enable PITR on your table and your backup is available for restore at any point in time from the moment you enable it, up to a maximum of the 35 preceding days. For example, imagine a test script writing accidentally to a production DynamoDB table. You could recover your table to any point in time within the last 35 days.

On-demand backups help with long-term archival requirements for regulatory compliance. On-demand backups give you full-control of managing the lifecycle of your backups, from creating as many backups as you need to retaining these for as long as you need.

## Enabling PITR during deployment

By default, the Cumulus [data-persistence module](https://github.com/nasa/cumulus/blob/master/tf-modules/data-persistence) enables PITR on the default tables listed in the [module's variable defaults](https://github.com/nasa/cumulus/blob/master/tf-modules/data-persistence/variables.tf) for `enable_point_in_time_tables`.  At the time of writing, that list includes:

* CollectionsTable
* ExecutionsTable
* FilesTable
* GranulesTable
* PdrsTable
* ProvidersTable
* RulesTable
* UsersTable

If you wish to change this list, simply update your deployment's `data_persistence` module ([here](https://github.com/nasa/cumulus-template-deploy/blob/master/data-persistence-tf/main.tf) in the `template-deploy` repository) to pass the correct list of tables.

## Backup and Restore with cumulus-api CLI

cumulus-api CLI also includes a backup and restore command. The CLI backup command downloads the content of any of your DynamoDB tables to `.json` files. You can also use these `.json` files to restore the records to another DynamoDB table.

### Backup with the CLI

To backup a table with the CLI, install the `@cumulus/api` package using [npm](https://www.npmjs.com/), making sure to install the same version as your Cumulus deployment:

```bash
npm install -g @cumulus/api@version
```

Then run:

```bash
cumulus-api backup --table <table-name>
```

the backup will be stored at `backups/<table-name>.json`

### Restore with the CLI

To restore data from a json file run the following command:

```bash
     ./node_modules/.bin/cumulus-api restore backups/<table-name>.json --table <new-table-name>
```

## DynamoDB Auto Scaling

Cumulus deployed tables from the [data-persistence module](https://github.com/nasa/cumulus/blob/master/tf-modules/data-persistence) are set to [`on-demand'](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html#HowItWorks.OnDemand) mode.
