---
id: version-v1.10.1-data_in_dynamodb
title: Cumulus Metadata in DynamoDB
hide_title: true
original_id: data_in_dynamodb
---

# Cumulus Metadata in DynamoDB
* [DynamoDB Backup and Restore](#backup-and-restore-with-aws)
* [DynamoDB Auto Scaling](#dynamodb-auto-scaling)

[@cumulus/api](https://www.npmjs.com/package/@cumulus/api) uses a number of methods to preserve the metadata generated in a Cumulus instance.

All configurations and system-generated metadata is stored in DynamoDB tables except the logs. System logs are stored in the AWS CloudWatch service.

`@cumulus/api` creates the following DynamoDB tables:

- **Users:** api/dashboard users
- **Collections:** collection records 
- **Providers:** provider records
- **Rules:** rules for managing and running workflows
- **Executions:** workflow executions (step function executions)
- **Granules:** granules processed by the Cumulus instance
- **PDRs:** PDRs processed in Cumulus

Amazon DynamoDB stores three geographically distributed replicas of each table to enable high availability and data durability. Amazon DynamoDB runs exclusively on solid-state drives (SSDs). SSDs help AWS achieve the design goals of predictable low-latency response times for storing and accessing data at any scale.

## Backup and Restore with AWS

You can enable point-in-time recovery (PITR) as well as create an on-demand backup for your Amazon DynamoDB tables.

PITR provides continuous backups of your DynamoDB table data. You can enable PITR with a single click from the AWS Management Console or a single API call. When enabled, DynamoDB maintains continuous backups of your table up to the last 35 days. You can recover a copy of that table to a previous state at any point in time from the moment you enable PITR, up to a maximum of the 35 preceding days. PITR provides continuous backups until you explicitly disable it.

On-demand backups allow you to create backups of DynamoDB table data and its settings. You can initiate an on-demand backup at any time with a single click from the AWS Management Console or a single API call. You can restore the backups to a new DynamoDB table in the same AWS Region at any time.

PITR gives your DynamoDB tables continuous protection from accidental writes and deletes. With PITR, you do not have to worry about creating, maintaining, or scheduling backups. You enable PITR on your table and your backup is available for restore at any point in time from the moment you enable it, up to a maximum of the 35 preceding days. For example, imagine a test script writing accidentally to a production DynamoDB table. You could recover your table to any point in time within the last 35 days.

On-demand backups help with long-term archival requirements for regulatory compliance. On-demand backups give you full-control of managing the lifecycle of your backups, from creating as many backups as you need to retaining these for as long as you need.

## Enabling PITR during deployment

You can enable point-in-time recovery on all existing tables in your `config.yml`. Add the following configuration to your `config.yml` under a deployment section:

```yaml
default:

    enablePointInTime: true
```

**Imoprtant Note:** Configuring point-in-time recovery is not supported by the CloudFormation (as of June 2018). We enable this feature deployment using AWS API. However, due to a limitation of AWS API, the feature fails to be enabled if it is running against newly created tables.

Therefore, if you are deploying a new stack, make sure the feature is turned off on your first deployment. You can turn it on and enable about an hour after your tables are created.


## Backup and Restore with cumulus-api CLI

cumulus-api CLI also includes a backup and restore command. The CLI backup command downloads the content of any of your DynamoDB tables to `.json` files. You can also use these `.json` files to restore the records to another DynamoDB table.

### Backup with the CLI

To backup a table with the CLI, make sure `@cumulus/api` package is installed. Then run:

     $ ./node_modules/.bin/cumulus-api backup --table <table-name>

the backup will be stored at `backups/<table-name>.json`

### Restore with the CLI

To restore data from a json file run the following command:

     $ ./node_modules/.bin/cumulus-api restore backups/<table-name>.json --table <new-table-name>

## DynamoDB Auto Scaling

`@cumulus/deployment` enables auto scaling of DyanmoDB tables. Auto scaling is configurable by table. `@cumulus/deployment` will setup auto scaling with some default values by simply adding the following lines to an `app/config.yml` file:

```
<deployment_name>:
  PdrsTable:
  Granules:
    enableAutoScaling: true  
```

### Defaults

By default, `@cumulus/deployment` will configure auto scaling with the following provisioned throughput values:

|              | Read | Write |
|--------------|------|-------|
| Min Capacity | 5    | 1     |
| Max Capacity | 10   | 2     |

Tables are launched with `Min Capacity` provisioned. To determine when to scale up or down, DynamoDB uses a Cloudwatch alarm to trigger autoscaling whenever read / write throughput exceeds some percentage of the current provisioned througput value. The following values are used to determine how and when to scale:

* **`TargetValue`:** A numeric value between 0 and 100 representing a percentage. When request througput exceeds or falls below `TargetValue` percent of the current provisioned value, DynamoDB scales up or down to `TargetValue` of current throughput.
* **`TargetValue`** defaults to 30, but can also be overriden in `app/config.yml`.
* **`ScaleInCooldown`** and **`ScaleOutCooldown`:** A numeric value representing the number of seconds DynamoDB Auto Scaling throughput should exhibit exceeding or subceeding the `TargetValue` percent of provisioned throughput before scaling up or down.
* **`ScaleInCooldown`** and **`ScaleOutCooldown`** default to 0 but can be overriden in `app/config.yml`

**Read more on the AWS Blog:** [How to use AWS CloudFormation to configure auto scaling for Amazon DynamoDB](https://aws.amazon.com/blogs/database/how-to-use-aws-cloudformation-to-configure-auto-scaling-for-amazon-dynamodb-tables-and-indexes/)

### Example

A fully customized `app/config.yml` for DynamoDB auto scaling might look something like the following:

```
<deployment_name>:
  AutoScalingPolicyConfiguration:
    targetValue: 70
    scaleInCooldown: 5
    scaleOutCooldown: 5
  CollectionsTable:
    enableAutoScaling: true
    ReadMinCapacity: 5
    ReadMaxCapacity: 10
    WriteMinCapacity: 1
    WriteMaxCapacity: 2
  ProvidersTable:
    ...
  RulesTable:
    ...
  UsersTable:
    ...
  GranulesTable:
    ...
  PdrsTable:
    ...
  ExecutionsTable:
    ...  
  FilesTable:
    enableAutoScaling: true
    ReadMinCapacity: 5
    ReadMaxCapacity: 10
    WriteMinCapacity: 20
    WriteMaxCapacity: 100
```

### Important Note!

DynamoDB Auto Scaling does not happen instantaneously. Delays of up to 10 minutes in auto scaling were experienced when load testing, and some requests failed. If application owners expect a high volume of throughput (for example, when doing a re-processing campaign), they should deploy tables with min capacity set at the required levels for meeting the expected request load.
