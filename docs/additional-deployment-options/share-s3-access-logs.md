---
id: share-s3-access-logs
title: Share S3 Access Logs
hide_title: true
---

# Sharing S3 Access Logs

In the NGAP environment, the ESDIS Metrics team has set up an ELK stack to process logs from Cumulus instances.  One step is to deliver any S3 Server Access logs that Cumulus creates.  We have provided a simple node package to aid this process.

# S3 Replicator

The S3 Replicator is a node package that contains a simple lambda functions, associated permissions and the terraform instructions to replicate create-object events from one S3 bucket to another.

First ensure that you have enabled [S3 Server Access Logging](../deployment/server_access_logging.md).

Next configure your `config.tfvars` as described in the s3-replicator/README.md to correspond to your deployment.  The `source_bucket` and `source_prefix` are determined by how you enabled the [S3 Server Access Logging](../deployment/server_access_logging.md). The `target_bucket` and `target_prefix` will come from the metrics team.

The metrics team has taken care of setting up logstash to ingest the files that get delivered to their bucket into their Elasticsearch instance.
