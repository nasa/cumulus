---
id: share-s3-access-logs
title: Share S3 Access Logs
hide_title: true
---

# Sharing S3 Access Logs

It is possible through Cumulus to share S3 access logs across multiple S3 packages using the S3 replicator package.

## S3 Replicator

The S3 Replicator is a node package that contains a simple lambda function, associated permissions, and the Terraform instructions to replicate create-object events from one S3 bucket to another.

First ensure that you have enabled [S3 Server Access Logging](../deployment/server_access_logging).

Next configure your `config.tfvars` as described in the s3-replicator/README.md to correspond to your deployment.  The `source_bucket` and `source_prefix` are determined by how you enabled the [S3 Server Access Logging](../deployment/server_access_logging).

## ESDIS Metrics

In the NGAP environment, the ESDIS Metrics team has set up an ELK stack to process logs from Cumulus instances.  To use this system, you must deliver any S3 Server Access logs that Cumulus creates.

Configure the S3 replicator as described above using the `target_bucket` and `target_prefix` provided by the metrics team.

The metrics team has taken care of setting up Logstash to ingest the files that get delivered to their bucket into their Elasticsearch instance.
