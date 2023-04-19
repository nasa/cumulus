---
id: upgrade-rds
title: Upgrade to RDS release
hide_title: false
---

## Background

This release of Cumulus (9.0.0) integrates with RDS and creates a new PostgreSQL database for archiving Cumulus data (e.g. granules, files, executions).

While eventually Cumulus will only support using a PostgreSQL-compatible database as its data archive, for now the system will perform **parallel writes** to both DynamoDB and PostgreSQL so that all new data is archived in both datastores.

However, in order to copy all of your previously written data from DynamoDB to PostgreSQL, you will need to run data migration scripts that we have provided and which this document will explain how to use.

## Upgrade steps

Follow the steps outlined below in precisely this order to upgrade your deployment and run the data migrations.

### 1. Deploy a new RDS cluster

Cumulus deployments require an Aurora [PostgreSQL 10.2](https://www.postgresql.org/) compatible database to be provided in addition to the existing DynamoDB/ElasticSearch backend with the eventual goal of utilizing the PostgreSQL database as the primary data store for Cumulus.

> **NOTE**: Users are *strongly* encouraged to plan for and implement a database solution that scales to their use requirements, meets their security posture and maintenance needs and/or allows for multi-tenant cluster usage.

Refer to the docs on [how to deploy a new RDS cluster](./../deployment/postgres-database-deployment.md).

### 2. Deploy your data-persistence module

The following new variables have been added to the data-persistence module:

- `vpc_id`
- `permissions_boundary_arn`
- `rds_user_access_secret_arn`
- `rds_security_group_id`

You will need to update your data-persistence module to include these new variables related to RDS. See the configuration in our template-deploy repo for reference: <https://github.com/nasa/cumulus-template-deploy/tree/master/data-persistence-tf>

Then you can re-deploy your data-persistence module as usual:

```bash
terraform apply
```

### 3. Deploy and run data-migration1

You will need to create a `data-migration1-tf` directory. See the configuration in our template-deploy repo for reference: <https://github.com/nasa/cumulus-template-deploy/tree/master/data-migration1-tf>

Navigate to the directory `data-migration1-tf` and copy the following `.example` files:

```shell
cp terraform.tf.example terraform.tf
cp terraform.tfvars.example terraform.tfvars
```

In `terraform.tf`, configure your remote state settings by replacing the appropriate value for `PREFIX`.

In `terraform.tfvars` replace the appropriate values for the following variables:

- `prefix`
- `data_persistence_remote_state_config`
- `permissions_boundary_arn`
- `lambda_subnet_ids`
- `vpc_id`
- `provider_kms_key_id`

These values should match the values used for your Cumulus Core deployment.

After replacing those values, run `terraform init`.
The output should resemble the following:

```shell
Initializing modules...

Initializing the backend...

Initializing provider plugins...
- Using previously-installed hashicorp/aws v3.34.0
- terraform.io/builtin/terraform is built in to Terraform

Terraform has been successfully initialized!
```

Run  `terraform apply` to deploy `data-migration1` and type `yes` when prompted to create those resources.
On success, you will see output like:

```shell
Apply complete! Resources: 2 added, 0 changed, 0 destroyed.
```

Once the deployment is complete, you can use the AWS Console or CLI to invoke the Lambda and start the data migration:

```bash
aws lambda invoke --function-name $PREFIX-data-migration1 $OUTFILE
```

where

- `PREFIX` is the `prefix` value used to deploy data-migration1-tf
- `OUTFILE` (**optional**) is the filepath where the Lambda output (data-migration1 summary) will be saved.

### 4. Deploy Cumulus module

The following variables were added to the Cumulus module

- `rds_security_group`
- `rds_user_access_secret_arn`

For reference on how to set these values, see our template-deploy repo: <https://github.com/nasa/cumulus-template-deploy/tree/master/cumulus-tf>

Instructions on deploying the Cumulus module can be found [here](./../deployment/README.md).

The `cumulus` module will create resources including the following relevant resources for the data migration:

- `${PREFIX}-data-migration2` Lambda
- `${PREFIX}-postgres-migration-async-operation` Lambda

### 5. Run the second data migration

> **Note**: Please read this entire section thoroughly before proceeding to run the second data migration. In particular, pay close attention to the notes about parallelism options in order to achieve desired data migration performance while avoiding database outages and data loss.

Now that Cumulus module is deployed, we can use some newly created resources to migrate granule, execution, and PDR data from DynamoDB to our PostgreSQL database.

This second data migration process can be run by invoking the provided `${PREFIX}-postgres-migration-async-operation` Lambda included in the Cumulus module deployment.
This Lambda starts an asynchronous operation which runs as an ECS task to run the migration.

To invoke the Lambda and start the data migration, you can use the AWS Console or CLI:

```bash
aws lambda invoke --function-name $PREFIX-postgres-migration-async-operation \
  --payload $PAYLOAD $OUTFILE
```

where

- `PAYLOAD` (**optional**) is a base64 encoded JSON object. No payload is required to run this data migration, but configuring some of the payload options for parallelism can significantly decrease the duration of the data migration. For reference, in our testing using a value of `50` for `executionMigrationParams.parallelScanSegments` and `executionMigrationParams.writeConcurrency` migrated ~900,000 execution records in 45 minutes and did not spike Aurora PostgreSQL database capacity above 2 ACUs. See the [full description of payload parameters below](#postgres-migration-async-operation-payload-parameters) for how to configure the parallelism of the migration. An example payload configuration might look like:

    ```bash
    --payload $(echo '{"executionMigrationParams": { "parallelScanSegments": 50,
    "writeConcurrency": 50 }}' | base64)
    ```

- `PREFIX` is your Cumulus deployment prefix.
- `OUTFILE` (**optional**) is the filepath where the Lambda output (data-migration2 summary) will be saved.

The Lambda will trigger an Async Operation and return an `id` such as:

```json
{"id":"7ccaed31-756b-40bb-855d-e5e6d00dc4b3","status":"RUNNING",
"taskArn":"arn:aws:ecs:us-east-1:AWSID:task/$PREFIX-CumulusECSCluster/123456789",
"description":"Data Migration 2 Lambda ECS Run","operationType":"Data Migration"}
```

which you can then query the Async Operations [API Endpoint](https://nasa.github.io/cumulus-api/#retrieve-async-operation) for the output or status of your request. If you want to directly observe the progress of the migration as it runs, you can view the CloudWatch logs for your async operations (e.g. `PREFIX-AsyncOperationEcsLogs`).

Also, each run of these data migration will write a timestamped log of any errors to the following keys in the configured `system_bucket` for your deployment:

- `<prefix>-data-migration2-execution-errors-${timestamp}.json`
- `<prefix>-data-migration2-granulesAndFiles-errors-${timestamp}.json`

> **Please note:** Since this data migration is copying **all of your execution, granule, and PDR data from DynamoDB to PostgreSQL**, it can take multiple hours (or even days) to run, depending on how much data you have and how much parallelism you configure the migration to use. In general, the more parallelism you configure the migration to use, the faster it will go, **but the higher load it will put on your PostgreSQL database. Excessive database load can cause database outages and result in data loss.** Thus, the parallelism settings for the migration are intentionally set by default to conservative values but are configurable.

#### postgres-migration-async-operation payload parameters

| Variable | Type | Description | Default |
|-|-|-|-|
| migrationsList | string[] | An array containing the names of the data types that you want to migrate. For the first run of this migration, you need to run at least the `executions` migration, since the other data types may need to refer to execution records existing in PostgreSQL. | ['executions', 'granules', 'pdrs']
| executionMigrationParams | Object | Options for the executions data migration | `{}`
| executionMigrationParams.parallelScanSegments | number | The number of [parallel scan] segments to use for executions data migration. The higher this number, the less time it will take to migrate all of your data, but also the more load that will be put on your PostgreSQL database. | 20
| executionMigrationParams.parallelScanLimit | number | The maximum number of records to return per each [parallel scan] of a segment. This option was mostly provided for testing and it is not recommended to set a value. | none
| executionMigrationParams.writeConcurrency | number | The maximum number of execution records to write concurrently to PostgreSQL. The higher this number, the less time it will take to migrate all of your data, but also the more load that will be put on your PostgreSQL database. | 10
| executionMigrationParams.loggingInterval | number | How many records to migrate before printing a log message on the status of the migration. | 100
| granuleMigrationParams | Object | Options for the granules data migration | `{}`
| granuleMigrationParams.collectionId | string | A collection ID (e.g. `shortname___version`) from granule DynamoDB records. If a `collectionId` is provided, then only granules for that collection will be migrated | none
| granuleMigrationParams.granuleId | string | A specific granule ID from a DynamoDB record to select for migration. If a `granuleId` and `collectionId` are provided, the `collectionId` will be ignored. | none
| granuleMigrationParams.parallelScanSegments | number | The number of [parallel scan] segments to use for granules data migration. The higher this number, the less time it will take to migrate all of your data, but also the more load that will be put on your PostgreSQL database. | 20
| granuleMigrationParams.parallelScanLimit | number | The maximum number of records to return per each [parallel scan] of a segment. This option was mostly provided for testing and it is not recommended to set a value. | none
| granuleMigrationParams.writeConcurrency | number | The maximum number of granule records to write concurrently to PostgreSQL. The higher this number, the less time it will take to migrate all of your data, but also the more load that will be put on your PostgreSQL database. | 10
| granuleMigrationParams.loggingInterval | number | How many records to migrate before printing a log message on the status of the migration. | 100
| pdrMigrationParams | Object | Options for the PDRs data migration | `{}`
| pdrMigrationParams.parallelScanSegments | number | The number of [parallel scan] segments to use for PDRs data migration. The higher this number, the less time it will take to migrate all of your data, but also the more load that will be put on your PostgreSQL database. | 20
| pdrMigrationParams.parallelScanLimit | number | The maximum number of records to return per each [parallel scan] of a segment. This option was mostly provided for testing and it is not recommended to set a value. | none
| pdrMigrationParams.writeConcurrency | number | The maximum number of PDR records to write concurrently to PostgreSQL. The higher this number, the less time it will take to migrate all of your data, but also the more load that will be put on your PostgreSQL database. | 10
| pdrMigrationParams.loggingInterval | number | How many records to migrate before printing a log message on the status of the migration. | 100

### 6. Run validation tool

We have provided a validation tool which provides a report regarding your data migration. For more information about this tool, refer to the [Postgres Migration Count Tool README](https://github.com/nasa/cumulus/blob/master/lambdas/postgres-migration-count-tool/README.md).

This tool can be run in the following two ways:

- Through direct Lambda invocation
- Through API invocation

> **Note:** If the migration validation tool reveals discrepancies between your DynamoDB and PostgreSQL data, you can [re-run the second data migration as described in step 5](#5-run-the-second-data-migration) to correct your data or to add missing data.

#### Direct Lambda invocation

Invoking the Lambda on the command line looks like:

```bash
aws lambda invoke --function-name $PREFIX-postgres-migration-count-tool \
  --payload $PAYLOAD $OUTFILE
```

where

- `PAYLOAD` is a base64 encoded JSON object. For example,

```bash
--payload $(echo '{"reportBucket": "someBucket", "reportPath": "somePath",
"cutoffSeconds": 60, "dbConcurrency": 20, "dbMaxPool": 20}' | base64)
```

- `OUTFILE` is the filepath to store the output from the Lambda.
- `PREFIX` is your Cumulus deployment prefix.

> **NOTE**: This will invoke the Lambda synchronously. Depending on your data holdings, the execution time of this Lambda may exceed the 15 minute AWS Lambda limit. **If this occurs, you will need to invoke the tool via the API as an asynchronous operation as described below.**

#### API invocation

Invoking the API on the command line looks like the following:

```bash
curl -X POST https://$API_URL/dev/migrationCounts -d 'reportBucket=someBucket&
reportPath=someReportPath&cutoffSeconds=60&dbConcurrency=20&dbMaxPool=20' --header
'Authorization: Bearer $TOKEN'
```

In this instance, the API will trigger an Async Operation and return an `id` such as:

```json
{"id":"7ccaed31-756b-40bb-855d-e5e6d00dc4b3","status":"RUNNING",
"taskArn":"arn:aws:ecs:us-east-1:AWSID:task/$PREFIX-CumulusECSCluster/123456789",
"description":"Migration Count Tool ECS Run","operationType":"Migration Count Report"}
```

which you can then query the Async Operations [API Endpoint](https://nasa.github.io/cumulus-api/#retrieve-async-operation) for the output or status of your request.

#### Payload parameters

The following optional parameters are used by this tool:
| Variable      | Type   | Description                                                                                                                                                                                       | Default |
|---------------|--------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| reportBucket  | string | Sets the bucket used for reporting. If this argument is used, a `reportPath` must be set to generate a report.                                                                                    |         |
| reportPath    | string | Sets the path location for the tool to write a copy of the Lambda payload to S3                                                                                                                   |         |
| cutoffSeconds | number | Number of seconds prior to this execution to 'cutoff' reconciliation queries. This allows in-progress/other in-flight operations time to complete and propagate to Elasticsearch/Dynamo/postgres. | 3600    |
| dbConcurrency | number | Sets max number of parallel collections reports the script will run at a time.                                                                                                                    | 20      |
| dbMaxPool     | number | Sets the maximum number of connections the database pool has available. Modifying this may result in unexpected failures.                                                                         | 20      |

[parallel scan]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Scan.html#Scan.ParallelScan
