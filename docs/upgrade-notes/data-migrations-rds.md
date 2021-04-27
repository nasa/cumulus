---
id: data_migrations_rds
title: Running data migrations for RDS
hide_title: false
---

## Background

This release of Cumulus (x.x.x) integrates with RDS and creates a new PostgreSQL database for archiving Cumulus data (e.g. granules, files, executions).

<<<<<<< HEAD
While eventually Cumulus will only support using RDS as its data archive, for now the system will perform **parallel writes** to both DynamoDB and PostgreSQL so that all new data is archived in both datastores.
=======
While eventually Cumulus will only support using RDS as its data archive, for now the system will do **parallel writes** to both DynamoDB and PostgreSQL so that all new data is archived in both datastores.
>>>>>>> 483a54841... initial stub of data migration & upgrade docs

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
<<<<<<< HEAD
From the top-level, navigate to the directory `data-migration1-tf` and copy the following `.example` files:

```shell
cd example/data-migration1-tf/
cp terraform.tf.example terraform.tf
cp terraform.tfvars.example terraform.tfvars
```

In `terraform.tf`, configure your remote state settings by replacing the appropriate value for `PREFIX`.

In `terraform.tfvars` replace the appropriate values for the following variables:

- `PREFIX`
- `permissions_boundary_arn`
- `lambda_subnet_ids`
- `vpc_id`
- `provider_kms_key_id`

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

### Deploy cumulus module
Navigate to the cumulus module and re-deploy:

```shell
cd cumulus-tf
terraform apply
```

The `cumulus` module will create resources including the following relevant resources for the data migration:

- `${PREFIX}-data-migration2` lambda
- `${PREFIX}-postgres-migration-async-operation` lambda

### Run data-migration2

Instructions on how to run your `data-migration2` lambda can be found in the `data-migration2` [README](../../lambdas/data-migration2/README.md).

### Run reconciliation tool
=======

### Deploy cumulus module

### Run data-migration2

### Run reconciliation tool?
>>>>>>> 483a54841... initial stub of data migration & upgrade docs
