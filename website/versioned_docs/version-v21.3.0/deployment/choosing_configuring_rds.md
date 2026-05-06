---
id: choosing_configuring_rds
title: "RDS: Choosing and Configuring Your Database Type"
hide_title: false
---

## Background

Cumulus uses a [PostgreSQL](https://www.postgresql.org/) database as its primary data store
for operational and archive records (e.g. collections, granules, etc). The Cumulus
core deployment code expects this database to be provided by the [AWS RDS](https://docs.aws.amazon.com/rds/index.html) service; however, it is agnostic about the type of the RDS database.

RDS databases are broadly divided into two types:

- **Provisioned**: Databases with a fixed capacity in terms of CPU and memory capacity. e.g. Memory optimized, Burstable, and Optimized Reads. You can find
a complete list of the available database instance class types in [this AWS documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.DBInstanceClass.html).
- **Serverless v2**: Databases that can scale their CPU and memory capacity up and down in response to database load. [Amazon Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_AuroraOverview.html) is the service which provides serverless RDS databases.

## Provisioned vs. Serverless

Generally speaking, the advantage of provisioned databases is that they **don't have to scale**.
As soon as they are deployed, they have the full capacity of your chosen instance size and are
ready for ingest operations. Of course, this advantage is also a downside: if you ever have a
sudden spike in database traffic, your database **can't scale** to accommodate that increased
load.

On the other hand, serverless databases are designed precisely to **scale in response to load**.
While the ability of serverless databases to scale is quite useful, there can be complexity in
setting the scaling configuration to achieve the best results. Recommendations for Aurora serverless database scaling configuration are provided in the section [below](#recommended-scaling-configuration-for-aurora-serverless).

To decide whether a provisioned or a serverless database is appropriate for your ingest
operations, you should consider the pattern of your data ingests.

If you have a fairly steady, continuous rate of data ingest, then a provisioned database
may be appropriate because your database capacity needs should be consistent and the lack of
scaling shouldn't be an issue.

If you have occasional, bursty ingests of data where you go from ingesting very little data
to suddenly ingesting quite a lot then a serverless database may be a better choice because it
will be able to handle the spikes in your database load.

## General Configuration Guidelines

### Aurora Serverless V2 Capacity Range

Serverless V2 allows users to configure the minumum and maximum number of ACUs the custer should use.

[The Aurora Serverless V2 Docs](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-administration.html#aurora-serverless-v2-setting-acus) provide guidance for determining your capacity requirements and modifying the capacity range of your RDS cluster.

### Cumulus Core Login Configuration

Cumulus Core uses a `admin_db_login_secret_arn` and (optionally) `user_credentials_secret_arn` as inputs that allow various Cumulus components to act as a database administrator and/or read/write user.   Those secrets should conform to the following format:

```json
{
  "database": "postgres",
  "dbClusterIdentifier": "clusterName",
  "engine": "postgres",
  "host": "xxx",
  "password": "defaultPassword",
  "port": 5432,
  "username": "xxx",
  "disableSSL": false,
  "rejectUnauthorized": false,
}
```

- `database` -- the PostgreSQL database used by the configured user
- `dbClusterIdentifier` -- the value set by the  `cluster_identifier` variable in the terraform module
- `engine` -- the Aurora/RDS database engine
- `host` -- the RDS service host for the database in the form (dbClusterIdentifier)-(AWS ID string).(region).rds.amazonaws.com
- `password` -- the database password
- `username` -- the account username
- `port` -- The database connection port, should always be 5432
- `rejectUnauthorized` -- If disableSSL is not set, set to false to allow self-signed certificates or non-supported CAs.  Defaults to false.
- `disableSSL` - If set to true, disable use of SSL with Core database connections.   Defaults to false.

#### SSL encryption

Current security policy/best practices require use of a SSL enabled configuration.   Cumulus by default expects a configuration that includes a datastore that requires an SSL connection with a recognized certificate authority (RDS managed databases configured to use SSL will automatically work as AWS provides AWS CA bundles in the Lambda runtime environment).    If deployed in an environment not making use of SSL, set `disableSSL` to `true` to disable this behavior.

#### Self-Signed Certs

Cumulus can accommodate a self-signed/unrecognized cert by setting `rejectUnauthorized` as `false` in the connection secret.  This will result Core allowing use of certs without a valid CA.

### Cumulus Serverless RDS Cluster Module

Cumulus provides a Terraform module that will deploy an Aurora Serverless RDS cluster. If you are
using this module to create your RDS cluster, you can configure the cluster minimum and maximum capacity, and more as seen in the [supported variables for the module](https://github.com/nasa/cumulus/blob/6f104a89457be453809825ac2b4ac46985239365/tf-modules/cumulus-rds-tf/variables.tf).

## Optional: Manage RDS Database with pgAdmin

### Setup SSM Port Forwarding

:::note

In order to perform this action you will need to deploy it within a VPC and have the credentials to access via NGAP protocols.

:::

For a walkthrough guide on how to utilize AWS's Session Manager for port forwarding to access the Cumulus RDS database go to the [Accessing Cumulus RDS database via SSM Port Forwarding](https://wiki.earthdata.nasa.gov/display/CUMULUS/Accessing+Cumulus+RDS+database+via+SSM+Port+Forwarding) article.
