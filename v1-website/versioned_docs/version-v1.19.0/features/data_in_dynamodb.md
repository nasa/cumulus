---
id: version-v1.19.0-data_in_dynamodb
title: Cumulus Metadata in DynamoDB
hide_title: true
original_id: data_in_dynamodb
---

# Cumulus Metadata in DynamoDB

- [DynamoDB Auto Scaling](#dynamodb-auto-scaling)

[@cumulus/api](https://www.npmjs.com/package/@cumulus/api) uses a number of methods to preserve the metadata generated in a Cumulus instance.

All configurations and system-generated metadata is stored in DynamoDB tables except the logs. System logs are stored in the AWS CloudWatch service.

Amazon DynamoDB stores three geographically distributed replicas of each table to enable high availability and data durability. Amazon DynamoDB runs exclusively on solid-state drives (SSDs). SSDs help AWS achieve the design goals of predictable low-latency response times for storing and accessing data at any scale.

## DynamoDB Auto Scaling

Cumulus deployed tables from the [data-persistence module](https://github.com/nasa/cumulus/blob/master/tf-modules/data-persistence) are set to [`on-demand`](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html#HowItWorks.OnDemand) mode.
