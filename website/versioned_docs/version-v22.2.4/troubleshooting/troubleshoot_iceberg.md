---
id: troubleshooting-iceberg
title: Troubleshooting Iceberg
hide_title: false
---

This document provides guidance on how to troubleshoot issues with the Iceberg tables and the components used to perform replication from Postgres to Iceberg.

## Troubleshooting

The simplest way to troubleshoot is to monitor the logs from the various containers. The Kafka connect container logs will indicate when the source connector reads from the Postgres replication slot and puts messages on the associated Kafka topic. This is useful for verifying that the first stage of the replication is working.

The bootstrap container logs provide detailed information about the rest of the replication process. The logs from the sink process and the compaction process will show up here. When new messages are available on the Kafka topic and the sync timer has expired you will see messages indicating how many messages the sink process has found and how it is writing out batches of updates to the Iceberg `staging` branch of the associated table. You will also see periodic logs from the compaction service as it checks to see if there are any updates to the `staging` branch. If so, you will see log messages indicating that it is compacting the staging branch and then copying it to the `main` branch. Any errors during this process should show up here.

If the CloudWatch logs do not provide enough detail it is possible to access the containers directly. The `kafka` container provides several scripts that can be useful for troubleshooting the replication. These can be accessed by opening a shell on the Fargate container as follows:

```bash
aws ecs execute-command \
    --cluster <ECS cluster name> \
    --task <replication task arn> \
    --container kafka \
    --interactive \
    --command "/bin/bash"
```

After that there are several useful scripts in the `scripts` directory. For example, to monitor messages on the Kafka topic for the replication of the `executions` table:

```bash
export PATH="$PATH:./scripts"

kafka-console-consumer.sh \
    --bootstrap-server localhost:9092 \
    --topic dbserver1.public.executions \
    --from-beginning | jq
```

## Discrepancies Between Postgres and Iceberg

If there is an issue with data missing from Iceberg the easiest way to resolve the discrepancies is to simulate an update to the rows in Postgres without actually modifying the rows. For example:

```sql
UPDATE granules
SET updated_at = updated_at
WHERE updated_at >= NOW() - INTERVAL '1 day';
```

That will force replication of all of the affected rows to populate the Iceberg tables.

If there is a major issue and a query is not possible to identify the missing rows the full database table can be deleted from Iceberg and the replication ECS task restarted to force a full repopulation of the table.

## Using DuckDB to Query

For best performance you will want to run on an EC2 instance within the account. You can connect from your laptop but the S3 downloads will significantly impact your performance, especially with a slower internet connection or when connected over VPN. You will need to set your AWS credentials prior to connecting and then run `duckdb`.

```sql
SET memory_limit='4GB';
SET threads=4;
SET parquet_metadata_cache=true;
SET enable_http_metadata_cache=true;

INSTALL aws;
LOAD aws;

CREATE SECRET (
    TYPE S3,
    PROVIDER credential_chain
);

ATTACH '<account id>' AS glue (
    TYPE iceberg,
    ENDPOINT_TYPE 'glue'
);
```

Then you can query tables. For example, if your database name is `cumulus`, you can query `granules` with:

```sql
SELECT *
FROM glue.cumulus.granules
WHERE cumulus_id = 123;
```

You can also connect to Postgres in the same DuckDB session:

```sql
ATTACH 'dbname=<dbname> host=<hostname> port=<port_number> user=<user> password=<password>' AS pg (TYPE postgres);

SELECT *
FROM pg.granules
WHERE cumulus_id = 123;
```

You can even join and query data from both Iceberg and Postgres in the same query.
