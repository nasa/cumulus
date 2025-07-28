---
id: update-granules-table-add-producer_granule_id 
title: Update granules table add producer_granule_id 
hide_title: false
---

## Background

As part of the work for [CUMULUS-4058 Handle Granules with Identical producerGranuleId in Different Collections]
(https://bugs.earthdata.nasa.gov/browse/CUMULUS-4058), we are adding a producer_granule_id column to the granules
table.

The following updates are included:

- Check for duplicate granule_id values
- Add a new producer_granule_id column to the granules table
- Populate the producer_granule_id column in batches with values from the granule_id column
- Make the producer_granule_id column NOT NULL and create an index on it

The updates will be automatically created as part of the bootstrap lambda function on deployment of the data-persistence module.

*In cases where the column and index are already applied, the updates will have no effect.*

## Prerequisite:

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

The migration script will abort if there are duplicate grarnule_id values in the granules table.

## Apply the Changes in Production Environment

With large database (e.g. number of rows in granules table is greater than 100,000), the updates must be applied manually since
the commands can take significant amount of time. Since the ALTER TABLE commands require an EXCLUSIVE LOCK on the table,
and populating the new column takes significant amount of time, it is recommended that
all database activity be quiesced. This means that Ingest and Archive and other Cumulus functions must be shutdown before and during these commands.

The table below from LP DAAC SNAPSHOT database provides the table sizes before and after the migration commands, and timings.  The commands are
run with 16ACUs.

| Table Name | Original Table Size | Migration Time (clock) | New Table Size | Number of Rows |
|---|---|---|---|---|
| granules | 118 GB | 16 hours | 118 GB | 163 M |

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

    Note: In rare instances if there are hung queries that are unable to resolve, it may be necessary to
    manually use psql [Server Signaling
    Functions](https://www.postgresql.org/docs/13/functions-admin.html#FUNCTIONS-ADMIN-SIGNAL)
    `pg_cancel_backend` and/or
    `pg_terminate_backend` to end the queries.

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

    Once installed, a tmux session is started with two windows. The primary window is used for running the
    migration script, while the secondary window is used to monitor the database. When the operator hits
    end of shift or is done monitoring for the day, the tmux session can be detached from and reattached to at a later time.

4. Run Migration Script
    The database login credentials can be retrieved from the prefix_db_login secret.
    When the migration script is running, perform step 5 to monitor the commands.

     ```sh
     cd
     curl -o /home/ssm-user/20250425134823_granules_add_producer_granule_id.py https://raw.githubusercontent.com/nasa/cumulus/master/packages/db/src/migrations/20250425134823_granules_add_producer_granule_id.py

     tmux new-session -s CumulusUpgrade -n add-producer_granule_id
     python3 /home/ssm-user/20250425134823_granules_add_producer_granule_id.py

     ```

    The actual number of rows updated in each batch may be less than BATCH_SIZE because cumulus_id values may not increase by exactly 1.

    Example output:
    ```sh
    $ python3 /home/ssm-user/20250425134823_granules_add_producer_granule_id.py
    Enter DB host []: cumulus-dev-rds-cluster.cluster-xxx.us-east-1.rds.amazonaws.com
    Enter DB port [5432]:
    Enter DB name []: cumulus_test_db
    Enter DB user []: cumulus_test
    Enter DB password []: 
    [2025-07-26T03:20:24.863452] Checking for duplicate granule_id values...
    [2025-07-26T03:20:24.863452] Checking for duplicate granule_id values...
    [2025-07-26T03:26:13.266883] No duplicate granule_id values found.
    [2025-07-26T03:26:13.267377] Adding column producer_granule_id if not present...
    [2025-07-26T03:26:13.470536] Column check complete.
    [2025-07-26T03:26:13.531711] Starting batch update using a single connection...
    [2025-07-26T03:26:13.553828] Updating rows where cumulus_id BETWEEN 3 AND 100002
    [2025-07-26T03:26:17.169326] Updating rows where cumulus_id BETWEEN 100003 AND 200002
    [2025-07-26T03:26:17.939732] Updating rows where cumulus_id BETWEEN 200003 AND 300002

    [2025-07-26T16:48:23.979485] Updating rows where cumulus_id BETWEEN 560200003 AND 560300002
    [2025-07-26T16:48:24.854294] Updating rows where cumulus_id BETWEEN 560300003 AND 560400002
    [2025-07-26T16:48:24.869539] Finished populating producer_granule_id column.
    [2025-07-26T16:48:24.869723] Setting producer_granule_id column to NOT NULL...
    [2025-07-26T16:51:32.881139] Column is now NOT NULL.
    [2025-07-26T16:51:32.881322] Creating index on producer_granule_id...
    [2025-07-26T17:28:25.693141] Index created.
    [2025-07-26T17:28:25.693327] Update completed successfully.
    ```

    The SQL commands used for migration are available
    [here](https://raw.githubusercontent.com/nasa/cumulus/master/packages/db/src/migrations/20250425134823_granules_add_producer_granule_id.sql)

5. Monitor the Running Command

    ```sh
    # From tmux CumulusUpgrade session, open another window
    <Ctrl>-b c

    psql -h <Endpoint for writer instance> -p <Port for database or 5432> -d <cumulus database name> -U <database admin user> -W

    select pid, query, state, wait_event_type, wait_event from pg_stat_activity where state = 'active';
    ```

6. Verify the Updates

     We can verify that the tables are updated successfully by checking the `\d table` results from psql.  The following are expected results.

    ```sh
    => \d+ granules;

              Column           |           Type           | Collation | Nullable |               Default    |                     Description                 
    ----------------------------+--------------------------+-----------+----------+-------------------------+--------------------------------------
    producer_granule_id        | text                     |           | not null |                          | Producer Granule Id

    Indexes:
    "granules_producer_granule_id_index" btree (producer_granule_id)
    ```

7. Close the Session

    Close the tmux session after the task is complete by `exit` or `<Ctrl>-b x`.
