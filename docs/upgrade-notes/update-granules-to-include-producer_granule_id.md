---
id: update-granules-to-include-producer_granule_id
title: Update granules to include producer_granule_id
hide_title: false
---

## Background

As part of the work for [CUMULUS-4058 Handle Granules with Identical producerGranuleId in Different
Collections](https://bugs.earthdata.nasa.gov/browse/CUMULUS-4058), we are adding a
producer_granule_id column to the granules table.

The following updates are included:

- Check for duplicate granule_id values
- Add a new producer_granule_id column to the granules table
- Populate the producer_granule_id column in batches with values from the granule_id column
- Make the producer_granule_id column NOT NULL and create an index on it
- Vacuum the granules table

The updates will be automatically created as part of the bootstrap lambda function on deployment of the data-persistence module.

*In cases where the column and index are already applied, the updates will have no effect.*

## Prerequisite

Verify that there are no duplicate granule_id values in the granules table.
If any are found, identify and remove the redundant records.

Previous Cumulus releases did not support ingesting the same granule_id across different collections.
Therefore, in theory, there should be no duplicate granule_id values in the granules table. However,
the current database schema does allow duplicates by design, as it enforces uniqueness only on the
combination of granule_id and collection_cumulus_id through a composite unique index.

To identify any duplicate granule_id values, run the following query:

```sql
SELECT granule_id, COUNT(*) AS count
FROM granules
GROUP BY granule_id
HAVING COUNT(*) > 1
ORDER BY count DESC;
```

:::note
The migration script will abort if there are duplicate granule_id values in the granules table.
:::

## Apply the Changes in Production Environment

For large databases (e.g., when the `granules` table contains more than 100,000 rows), updates must
be applied manually, as the commands can take a significant amount of time. Since `ALTER TABLE`
commands require an **exclusive lock** on the table, and populating the new column is time-consuming,
it is recommended to **quiesce all database activity** during this process. This means pausing
Ingest, Archive, and other Cumulus functions before and during the execution of these commands.

The table below, from the LP DAAC SNAPSHOT database running on Aurora Serverless v2 with
PostgreSQL 17.4, shows the table sizes before and after the migration commands, along with their
execution times. The commands were run using 32 ACUs, and table sizes were measured using the
following query:

```sql
SELECT pg_size_pretty(pg_total_relation_size('granules'));
```

| Table Name | Original Table Size | New Table Size | Number of Rows | Migration Time |
|---|---|---|---|---|
| granules | 230 GB | 241 GB | 163 M | 10 hours 40 minutes (1 worker)<br />3 hours 40 minutes (5 workers)<br />2 hours 30 minutes (10 workers) |

## Tools Used

Since the update commands can take a few hours to run based on table size and IO throughput, it is recommended that the commands are run in an EC2 instance
in the AWS environment in a tmux or screen session. This will minimize the number of network hops and potential disconnects between the database client
and the database. Additionally, this will allow operators applying the patch to check on progress periodically and not worry about credential expiration or
other issues that would result in the client being killed.

## Upgrade Steps

1. Quiesce ingest

    Stop all ingest operations in Cumulus Core according to your operational procedures. You should validate
    that it appears there are no active queries that appear to be inserting granules/files into the database
    as a secondary method of evaluating the database system state:

    ```text
    select pid, query, state, wait_event_type, wait_event from pg_stat_activity where state = 'active';
    ```

    If query rows are returned with a `query` value that involves the tables, make sure ingest is halted
    and no other granule-update activity is running on the system.

    :::note
    In rare instances if there are hung queries that are unable to resolve, it may be necessary to
    manually use psql [Server Signaling
    Functions](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADMIN-SIGNAL)
    `pg_cancel_backend` and/or
    `pg_terminate_backend` to end the queries.
    :::

2. Login into EC2 instance with database access.

    From AWS console: Go to EC2, pick a `<prefix>-CumulusECSCluster` instance, click Connect, click Session Manager
    and click the Connect button.

    From AWS CLI: aws ssm start-session --target `EC2 Instance ID`.
  
    :::note Remember to take a note on which instance you run the commands.

3. Install tmux, postgres client and python packages

    ```sh
    sudo yum install -y tmux
    sudo dnf install -y postgresql17
    sudo dnf install -y python3 python3-pip
    pip3 install --user psycopg2-binary
    ```

    Once installed, a `tmux` session is started with two windows. Alternatively, you can open two
    concurrent SSM sessions to the same EC2 instance and start a separate tmux session from each.

    The primary window is used to run the migration script, while the secondary window is used
    to monitor the database. When the operator's shift ends or monitoring is no longer needed,
    the tmux session can be detached and reattached later as needed.

4. Run Migration Script
    The database login credentials can be retrieved from the `<prefix>_db_login` secret.
    When the migration script is running, perform step 5 to monitor the commands.

    ```sh
    curl -o /home/ssm-user/20250425134823_granules_add_producer_granule_id.py https://raw.githubusercontent.com/nasa/cumulus/master/packages/db/src/migrations/20250425134823_granules_add_producer_granule_id.py

    tmux new-session -s CumulusUpgrade -n add-producer_granule_id
    python3 /home/ssm-user/20250425134823_granules_add_producer_granule_id.py
    ```

    :::note
    **BATCH SIZE**: The actual number of rows updated in each batch may be less than BATCH_SIZE because
    cumulus_id values may not increase by exactly 1.

    **Number of parallel workers**: This value controls how many concurrent threads process batches of
    `producer_granule_id` updates. Increasing it can speed up processing but may also increase the load
    on the database. Adjust based on system capacity and performance needs.
    :::

    Example output from migrating the LP DAAC SNAPSHOT database:

    ```sh
    $ python3 /home/ssm-user/20250425134823_granules_add_producer_granule_id.py
    Enter DB host []: cumulus-dev-rds-cluster.cluster-xxx.us-east-1.rds.amazonaws.com
    Enter DB port [5432]:
    Enter DB name []: cumulus_test_db
    Enter DB user []: cumulus_test
    Enter DB password:
    Enter BATCH SIZE for populating column [100000]:
    Number of parallel workers [1]: 5
    Batch Update Recovery mode? (Y/N) [N]:
    [2025-08-28T12:24:19.981864] Checking for duplicate granule_id values...
    [2025-08-28T12:35:40.802003] No duplicate granule_id values found.
    [2025-08-28T12:35:40.802177] Adding column producer_granule_id if not present...
    [2025-08-28T12:35:41.279347] Column check complete.
    [2025-08-28T12:35:41.279536] Disabling autovacuum on granules table...
    [2025-08-28T12:35:41.293261] Autovacuum disabled.
    [2025-08-28T12:35:41.295678] Fetching min/max cumulus_id values (Normal mode)...
    [2025-08-28T12:35:41.336381] Populating cumulus_id range: 3 to 560391416
    [2025-08-28T12:35:41.336432] Starting parallel batch update with 5 worker(s)...
    [2025-08-28T12:35:41.355991] [Worker] Updating rows where cumulus_id BETWEEN 3 AND 100002
    [2025-08-28T12:35:41.361517] [Worker] Updating rows where cumulus_id BETWEEN 200003 AND 300002
    [2025-08-28T12:35:41.361676] [Worker] Updating rows where cumulus_id BETWEEN 100003 AND 200002
    [2025-08-28T12:35:41.361784] [Worker] Updating rows where cumulus_id BETWEEN 300003 AND 400002
    [2025-08-28T12:35:41.361893] [Worker] Updating rows where cumulus_id BETWEEN 400003 AND 500002
    [2025-08-28T12:36:12.394086] [Worker] Updated 23062 rows where cumulus_id BETWEEN 300003 AND 400002
    [2025-08-28T12:36:12.394207] [Worker] Updated 23028 rows where cumulus_id BETWEEN 200003 AND 300002
    [2025-08-28T12:36:12.410337] [Worker] Updating rows where cumulus_id BETWEEN 500003 AND 600002
    [2025-08-28T12:36:12.410914] [Worker] Updating rows where cumulus_id BETWEEN 600003 AND 700002
    [2025-08-28T12:36:12.413539] [Worker] Updated 22829 rows where cumulus_id BETWEEN 100003 AND 200002
    ...
    [2025-08-28T15:31:50.150774] [Worker] Updating rows where cumulus_id BETWEEN 560100003 AND 560200002
    [2025-08-28T15:31:51.161134] [Worker] Updated 2825 rows where cumulus_id BETWEEN 560100003 AND 560200002
    [2025-08-28T15:31:51.178434] [Worker] Updating rows where cumulus_id BETWEEN 560200003 AND 560300002
    [2025-08-28T15:31:53.548197] [Worker] Updated 19121 rows where cumulus_id BETWEEN 559900003 AND 560000002
    [2025-08-28T15:31:53.564171] [Worker] Updating rows where cumulus_id BETWEEN 560300003 AND 560391416
    [2025-08-28T15:31:53.625941] [Worker] Updated 3 rows where cumulus_id BETWEEN 560300003 AND 560391416
    [2025-08-28T15:31:54.883654] [Worker] Updated 16801 rows where cumulus_id BETWEEN 560000003 AND 560100002
    [2025-08-28T15:31:57.284970] [Worker] Updated 21143 rows where cumulus_id BETWEEN 560200003 AND 560300002
    [2025-08-28T15:31:57.933015] [Worker] Updated 60548 rows where cumulus_id BETWEEN 559600003 AND 559700002
    [2025-08-28T15:31:58.171666] [Worker] Updated 59506 rows where cumulus_id BETWEEN 559500003 AND 559600002
    [2025-08-28T15:31:58.172481] Parallel batch update complete.
    [2025-08-28T15:31:58.175522] Setting producer_granule_id column to NOT NULL...
    [2025-08-28T15:35:28.853811] Column is now NOT NULL.
    [2025-08-28T15:35:28.853993] Vacuuming granules table...
    [2025-08-28T15:47:06.325941] Vacuum complete.
    [2025-08-28T15:47:06.326141] Creating index on producer_granule_id...
    [2025-08-28T15:59:29.662899] Index created.
    [2025-08-28T15:59:29.663072] Re-enabling autovacuum on granules table...
    [2025-08-28T15:59:29.711125] Autovacuum re-enabled.
    [2025-08-28T15:59:29.713473] Update completed successfully.
    ```

    :::note RECOVERY_MODE
    If the migration is incomplete (e.g., the `producer_granule_id` column is partially populated),
    you can run the script in **recovery mode** to resume the migration process. The script will skip
    records that have already been migrated.
    :::

    You can find the SQL commands used for the migration
    [here](https://raw.githubusercontent.com/nasa/cumulus/master/packages/db/src/migrations/20250425134823_granules_add_producer_granule_id.sql)
    for your reference.

5. Monitor the Running Command

    ```sh
    # From tmux CumulusUpgrade session, open another window
    <Ctrl>-b c

    psql -h <Endpoint for writer instance> -p <Port for database or 5432> -d <cumulus database name> -U <database admin user> -W

    select pid, query, state, wait_event_type, wait_event from pg_stat_activity where state = 'active';
    ```

6. Verify the Updates

    We can verify that the tables are updated successfully by checking the `\d+ table` results from psql.  The following are expected results.

    ```sh
    => \d+ granules;

              Column           |           Type           | Collation | Nullable |               Default    |           Description
    ---------------------------+--------------------------+-----------+----------+--------------------------+------------------------------
    producer_granule_id        | text                     |           | not null |                          | Producer Granule Id

    Indexes:
    "granules_producer_granule_id_index" btree (producer_granule_id)
    ```

7. Make Sure Autovacuum Is Re-Enabled

   The output of `\d+ granules` should **NOT** have output `Options: autovacuum_enabled=false, toast.autovacuum_enabled=false`.
   You can also run the following query:

    ```sh
    SELECT relname AS table_name, reloptions
    FROM pg_class
    WHERE relname = 'granules';
    ```

    reloptions should **NOT** includes `autovacuum_enabled=false`

8. Close the Session

    Close the tmux session after the task is complete by `exit` or `<Ctrl>-b x`.
