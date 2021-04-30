---
id: data_migrations_rds
title: Running data migrations for RDS
hide_title: false
---

## Background

This release of Cumulus (x.x.x) integrates with RDS and creates a new PostgreSQL database for archiving Cumulus data (e.g. granules, files, executions).

While eventually Cumulus will only support using a PostgreSQL-compatible database as its data archive, for now the system will perform **parallel writes** to both DynamoDB and PostgreSQL so that all new data is archived in both datastores.

However, in order to copy all of your previously written data from DynamoDB to PostgreSQL, you will need to run data migration scripts that we have provided and which this document will explain how to use.

## Upgrade steps

Follow the steps outlined below in precisely this order to upgrade your deployment and run the data migrations.

### 1. Deploy a new RDS cluster

Cumulus deployments require an Aurora [PostgreSQL 10.2](https://www.postgresql.org/) compatible database to be provided in addition to the existing DynamoDB/ElasticSearch backend with the eventual goal of utilizing the PostgreSQL database as the primary data store for Cumulus.

> **NOTE**: Users are *strongly* encouraged to plan for and implement a database solution that scales to their use requirements, meets their security posture and maintenance needs and/or allows for multi-tenant cluster usage.

Refer to the docs on [how to deploy a new RDS cluster](./../deployment/postgres-database-deployment.md).

### 2. Deploy your data-persistence module

The following new variables have been added:

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

### 4. Deploy Cumulus module

The following variables were added to the Cumulus module

- `rds_security_group`
- `rds_user_access_secret_arn`
- `rds_connection_heartbeat`

Instructions on deploying the Cumulus module can be found [here](./../deployment/README.md).

The `cumulus` module will create resources including the following relevant resources for the data migration:

- `${PREFIX}-data-migration2` lambda
- `${PREFIX}-postgres-migration-async-operation` lambda

### 5. Run data-migration2

This second Lambda in the data migration process can be run by invoking an async operation using the provided `${PREFIX}-postgres-migration-async-operation` Lambda included in the cumulus module deployment.

This lambda invokes an asynchronous operation which starts an ECS task to run the `data-migration2` lambda.

To invoke the lambda, you can use the AWS Console or CLI:

```shell
aws lambda invoke --function-name ${PREFIX}-postgres-migration-async-operation
```

where you will need to replace `${PREFIX}` with your Cumulus deployment prefix.

### 6. Run validation tool

We have provided a validation tool which provides a report regarding your data migration. For more information about this tool, refer to the [Postgres Migration Count Tool README](./../lambdas/postgres-migration-count-tool/README.md)

This tool can be run in the following two ways:

- Through direct lambda invocation
- Through API invocation

#### Direct lambda invocation

Invoking the lambda on the command line looks like:

```bash
aws lambda invoke --function-name $PREFIX-postgres-migration-count-tool --payload $PAYLOAD $OUTFILE
```

where

- `PAYLOAD` is a base64 encoded JSON object. For example,

```bash
--payload $(echo '{"reportBucket": "someBucket", "reportPath": "somePath", "cutoffSeconds": 60, "dbConcurrency": 20, "dbMaxPool": 20}' | base64)
```

- `OUTFILE` is the filepath to store the output from the lambda.
- `PREFIX` is your Cumulus deployment prefix.

> **NOTE**: This will invoke the lambda synchronously. Depending on your data holdings, the execution time of this lambda may exceed the 15 minute AWS Lambda limit. **If this occurs, you will need to invoke the tool via the API as an asynchronous operation.**

#### API invocation

Invoking the API on the command line looks like the following:

```bash
curl -X POST https://$API_URL/dev/migrationCounts -d 'reportBucket=someBucket&reportPath=someReportPath&cutoffSeconds=60&dbConcurrency=20&dbMaxPool=20' --header 'Authorization: Bearer $TOKEN'
```

In this instance, the API will trigger an Async Operation and return an `id` such as:

```json
{"id":"7ccaed31-756b-40bb-855d-e5e6d00dc4b3","status":"RUNNING","taskArn":"arn:aws:ecs:us-east-1:AWSID:task/$PREFIX-CumulusECSCluster/123456789","description":"Migration Count Tool ECS Run","operationType":"Migration Count Report"}
```

which you can then query the Async Operations [API Endpoint](https://nasa.github.io/cumulus-api/#retrieve-async-operation) for the output or status of your request.

#### Payload parameters

The following optional parameters are used by this tool:
| Variable      | Type   | Description                                                                                                                                                                                       | Default |
|---------------|--------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| reportBucket  | string | Sets the bucket used for reporting. If this argument is used, a `reportPath` must be set to generate a report.                                                                                    |         |
| reportPath    | string | Sets the path location for the tool to write a copy of the lambda payload to S3                                                                                                                   |         |
| cutoffSeconds | number | Number of seconds prior to this execution to 'cutoff' reconciliation queries. This allows in-progress/other in-flight operations time to complete and propagate to Elasticsearch/Dynamo/postgres. | 3600    |
| dbConcurrency | number | Sets max number of parallel collections reports the script will run at a time.                                                                                                                    | 20      |
| dbMaxPool     | number | Sets the maximum number of connections the database pool has available. Modifying this may result in unexpected failures.                                                                         | 20      |
