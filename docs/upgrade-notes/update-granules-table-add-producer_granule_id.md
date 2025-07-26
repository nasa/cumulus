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

## Apply the Changes in Production Environment

With large database (e.g. number of rows in granules table is greater than 100,000), the updates must be applied manually since
the commands can take significant amount of time. Since the ALTER TABLE commands require an EXCLUSIVE LOCK on the table,
and populating the new column takes significant amount of time, it is recommended that
all database activity be quiesced. This means that Ingest and Archive and other Cumulus functions must be shutdown before and during these commands.

The table below from LP DAAC SNAPSHOT database provides the table sizes before and after the migration commands, and timings.  The commands are
run with 16ACUs.

| Table Name | Original Table Size | ALTER Run Time (clock) | New Table Size | Number of Rows |
|---|---|---|---|---|
| granules | 1.8 TB | 41 hours | 1.4 TB | 374,170,855 |

## Tools Used

Since the update commands can take a few hours to run based on table size and IO throughput, it is recommended that the commands are run in an EC2 instance
in the AWS environment in a tmux or screen session. This will minimize the number of network hops and potential disconnects between the database client
and the database. Additionally, this will allow operators applying the patch to check on progress periodically and not worry about credential expiration or
other issues that would result in the client being killed.

## Suggestions

- Backup database before applying the updates, see the
  [Backup and Restore document](https://nasa.github.io/cumulus/docs/features/backup_and_restore/#postgres-database).

- To get a more accurate downtime estimate, you can take a snapshot of your database, and run the migration on it.

- This upgrade should work on prior Cumulus releases, so the upgrade can be performed when maintenance windown allows
  without having to upgrade Cumulus.

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

3. Install tmux and postgres client

    ```sh
    sudo yum install -y tmux
    # Amazon Linux 2
    sudo amazon-linux-extras install postgresql13
    # Amazon Linux 2023
    sudo dnf install -y postgresql15
    ```

    Once installed, a tmux session is started with two windows. The Cumulus database is connected to in each window
    using the PostgreSQL client. The primary window is used for running the ALTER commands, while the secondary window
    is used to monitor the database and alter statement. When the operator hits end of shift or is done monitoring for
    the day, the tmux session can be detached from and reattached to at a later time.

4. Run SQL Commands
    The database login credentials can be retrieved from the prefix_db_login secret.
    When the SQL commands are running, perform step 5 to monitor the commands.

    ```sh
    tmux new-session -s CumulusUpgrade -n add-producer_granule_id

    psql -h <Endpoint for writer instance> -p <Port for database or 5432> -d <cumulus database name> -U <database admin user> -W
    #e.g. psql -h cumulus-dev-rds-cluster.cluster-xxx.us-east-1.rds.amazonaws.com -p 5432 -d cumulus_test_db -U cumulus_test -W

    # Use -f option to run the SQL commands from a file
    psql -h <Endpoint for writer instance> -p <Port for database or 5432> -d <cumulus database name> -U <database admin user> -f 20240124101001_update_cumulus_id_add_indexes.sql -W
    ```

    The following are SQL commands, and 20250425134823_granules_add_producer_granule_id.sql is available
    [here](https://raw.githubusercontent.com/nasa/cumulus/master/packages/db/src/migrations/20250425134823_granules_add_producer_granule_id.sql):

    ```sql
    ....
    ```

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
    => \d granules;

              Column           |           Type           | Collation | Nullable |                    Default                     
    ----------------------------+--------------------------+-----------+----------+------------------------------------------------
    producer_granule_id        | text                     |           | not null |

    Indexes:
    "granules_producer_granule_id_index" btree (producer_granule_id)
    ```

7. Close the Session

    Close the tmux session after the task is complete by `exit` or `<Ctrl>-b x`.
