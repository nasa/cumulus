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

The table below, from the LP DAAC SNAPSHOT database, shows table sizes before and after the
migration commands, along with their execution times. The commands were run using 32 ACUs. Table
sizes were measured using the following query:

```sql
SELECT pg_size_pretty(pg_total_relation_size('granules'));
```

| Table Name | Original Table Size | New Table Size | Number of Rows | Migration Time |
|---|---|---|---|---|
| granules | 263 GB | 274 GB | 163 M | 14 hours (1 worker), 5.5 hours (5 workers) |

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
    # Amazon Linux 2023
    sudo dnf install -y postgresql15
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

    :::note BATCH_SIZE
    The actual number of rows updated in each batch may be less than BATCH_SIZE because cumulus_id values
    may not increase by exactly 1.
    :::

    Example output:

    ```sh
    $ python3 /home/ssm-user/20250425134823_granules_add_producer_granule_id.py
    Enter DB host []: cumulus-dev-rds-cluster.cluster-xxx.us-east-1.rds.amazonaws.com
    Enter DB port [5432]:
    Enter DB name []: cumulus_test_db
    Enter DB user []: cumulus_test
    Enter DB password:
    Enter BATCH SIZE for populating column [100000]: 10000
    Number of parallel workers [1]: 5
    Batch Update Recovery mode? (Y/N) [N]:
    [2025-07-28T21:56:21.055639] Checking for duplicate granule_id values...
    [2025-07-28T21:56:21.434586] No duplicate granule_id values found.
    [2025-07-28T21:56:21.434738] Adding column producer_granule_id if not present...
    [2025-07-28T21:56:21.487823] Column check complete.
    [2025-07-28T21:56:21.487971] Fetching min/max cumulus_id values (Normal mode)...
    [2025-07-28T21:56:21.526511] Populating cumulus_id range: 123 to 1010205
    [2025-07-28T21:56:21.526557] Starting parallel batch update with 5 worker(s)...
    [2025-07-28T21:56:21.563192] [Worker] Updating rows where cumulus_id BETWEEN 20123 AND 30122
    [2025-07-28T21:56:21.563477] [Worker] Updating rows where cumulus_id BETWEEN 10123 AND 20122
    [2025-07-28T21:56:21.568455] [Worker] Updating rows where cumulus_id BETWEEN 123 AND 10122
    ...
    [2025-07-28T21:57:57.166841] [Worker] Updated 10000 rows where cumulus_id BETWEEN 980123 AND 990122
    [2025-07-28T21:57:57.865475] [Worker] Updated 10000 rows where cumulus_id BETWEEN 1000123 AND 1010122
    [2025-07-28T21:57:57.866147] Parallel batch update complete.
    [2025-07-28T21:57:57.866269] Setting producer_granule_id column to NOT NULL...
    [2025-07-28T21:57:58.152544] Column is now NOT NULL.
    [2025-07-28T21:57:58.152706] Creating index on producer_granule_id...
    [2025-07-28T21:58:02.324241] Index created.
    [2025-07-28T21:58:02.324710] Vacuuming granules table...
    [2025-07-28T21:58:03.271800] Vacuum complete.
    [2025-07-28T21:58:03.272240] Update completed successfully.
    ```

    :::note RECOVERY_MODE
    If the migration is incomplete (e.g., the `producer_granule_id` column is not fully populated),
    you can run the script in **recovery mode** to resume the migration process.
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

7. Close the Session

    Close the tmux session after the task is complete by `exit` or `<Ctrl>-b x`.
