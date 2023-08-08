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

- **Provisioned**: Databases with a fixed capacity in terms of CPU and memory capacity. You can find
a list of the available database instance sizes in [this AWS documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.DBInstanceClass.html).
- **Serverless**: Databases that can scale their CPU and memory capacity up and down in response to database load. [Amazon Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_AuroraOverview.html) is the service which provides serverless RDS databases.

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

## Recommended Scaling Configuration for Aurora Serverless

If you are going to use an Aurora Serverless RDS database, we recommend the following scaling recommendations:

- Set the autoscaling timeout to 1 minute (currently the lowest allowed value)
- Set the database to force capacity change if the autoscaling timeout is reached

The reason for these recommendations requires an understanding of Aurora Serverless scaling.
Aurora Serverless scaling works as described in [the Amazon Aurora documentation](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless.how-it-works.html):

> When it does need to perform a scaling operation, Aurora Serverless v1 first tries to identify a scaling point, a moment when no queries are being processed.

However, during periods of heavy ingest, Cumulus will be continuously writing granules and other
records to the database, so a "scaling point" will never be reached. This is where the
"autoscaling timeout" setting becomes important. The "autoscaling timeout" is the amount of time
that Aurora will wait to find a "scaling point" before giving up.

So with the above recommended settings, we are telling Aurora to only wait for a "scaling point"
for 1 minute and that if a "scaling point" cannot be found in that time, then we should
**force the database to scale anyway**. These settings effectively make the Aurora Serverless database scale as quickly as possible in response to increased database load.

With forced scaling on databases, there is a consequence that some running queries or transactions
may be dropped. However, Cumulus write operations are written with automatic retry logic, so any
write operations that failed due to database scaling should be retried successfully.

### Cumulus Serverless RDS Cluster Module

Cumulus provides a Terraform module that will deploy an Aurora Serverless RDS cluster. If you are
using this module to create your RDS cluster, you can configure the autoscaling timeout action,
the cluster minimum and maximum capacity, and more as seen in the [supported variables for the module](https://github.com/nasa/cumulus/blob/6f104a89457be453809825ac2b4ac46985239365/tf-modules/cumulus-rds-tf/variables.tf).

Unfortunately, Terraform currently doesn't allow specifying the autoscaling timeout itself, so
that value will have to be manually configured in the AWS console or CLI.

## Optional: Manage RDS Database with pgAdmin

### Setup SSM Port Forwarding

:::note

In order to perform this action you will need to deploy it within a VPC and have the credentials to access via NGAP protocols.

:::

For a walkthrough guide on how to utilize AWS's Session Manager for port forwarding to access the Cumulus RDS database go to the [Accessing Cumulus RDS database via SSM Port Forwarding](https://wiki.earthdata.nasa.gov/display/CUMULUS/Accessing+Cumulus+RDS+database+via+SSM+Port+Forwarding) article.
