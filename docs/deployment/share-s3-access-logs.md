---
id: share-s3-access-logs
title: Share S3 Access Logs
hide_title: false
---

It is possible through Cumulus to share S3 access logs across multiple S3 packages using the S3 replicator package.

## S3 Replicator

The S3 Replicator is a Node.js package that contains a simple Lambda function, associated permissions, and the Terraform instructions to replicate create-object events from one S3 bucket to another.

First ensure that you have enabled [S3 Server Access Logging](../configuration/server_access_logging).

Next configure your `config.tfvars` as described in the [`s3-replicator/README.md`](https://github.com/nasa/cumulus/blob/master/tf-modules/s3-replicator/README.md) to correspond to your deployment.  The `source_bucket` and `source_prefix` are determined by how you enabled the [S3 Server Access Logging](../configuration/server_access_logging).

In order to deploy the `s3-replicator` with cumulus you will need to add the module to your terraform `main.tf` definition as the example below:

```hcl
module "s3-replicator" {
  source = "<path to s3-replicator.zip>"
  prefix               = var.prefix
  vpc_id               = var.vpc_id
  subnet_ids           = var.subnet_ids
  permissions_boundary = var.permissions_boundary_arn
  source_bucket        = var.s3_replicator_config.source_bucket
  source_prefix        = var.s3_replicator_config.source_prefix
  target_bucket        = var.s3_replicator_config.target_bucket
  target_prefix        = var.s3_replicator_config.target_prefix
}
```

The Terraform source package can be found on the [Cumulus GitHub Release page](https://github.com/nasa/cumulus/releases) under the asset tab `terraform-aws-cumulus-s3-replicator.zip`.

## ESDIS Metrics

In the NGAP environment, the ESDIS Metrics team has set up an ELK stack to process logs from Cumulus instances.  To use this system, you must deliver any S3 Server Access logs that Cumulus creates.

Configure the S3 Replicator as described above using the `target_bucket` and `target_prefix` provided by the Metrics team.

The Metrics team has taken care of setting up Logstash to ingest the files that get delivered to their bucket into their Elasticsearch instance.


:::info

For a more in-depth overview regarding ESDIS Metrics view the [Cumulus Distribution Metrics](../features/distribution-metrics.md) section.

:::
