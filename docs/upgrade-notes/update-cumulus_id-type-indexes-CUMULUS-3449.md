---
id: update-cumulus_id-type-indexes-CUMULUS-3449
title: Update Cumulus_id Type and Indexes
hide_title: false
---

## Background

As part of the work for [CUMULUS-3449](https://bugs.earthdata.nasa.gov/browse/CUMULUS-3449), LPDAAC have identified some Cumulus Core changes in
regards to the database in order to improve query performance. For other recommendations and considerations, see LPDAAC wiki
[Cumulus RDS Index testing](https://wiki.earthdata.nasa.gov/pages/viewpage.action?spaceKey=LPCUMULUS&title=Cumulus+RDS+Index+testing).

The following updates are included:

- Update some cumulus_id columns to BIGINT to allow future data grows and fix data type mismatch between primary key and foreign key. The columns are:
  - executions.cumulus_id
  - executions.parent_cumulus_id
  - files.granule_cumulus_id
  - granules_executions.granule_cumulus_id
  - granules_executions.execution_cumulus_id
  - pdrs.execution_cumulus_id

- Update indexes to provide the best chances of joins between tables
  - Change granules table unique constraint from
    `granules_granule_id_collection_cumulus_id_unique UNIQUE (granule_id, collection_cumulus_id)`
    to
    `granules_collection_cumulus_id_granule_id_unique UNIQUE (collection_cumulus_id, granule_id)`
  - Add indexes `granules_granule_id_index` and `granules_provider_collection_cumulus_id_granule_id_index`
    to `granules` table

The updates will be automatically created as part of the bootstrap lambda function on deployment of the data-persistence module.

*In cases where the type update and indexes are already applied, the updates will have no effect.*

## Apply the Changes in Production Environment

In production and some UAT environments, the type updates and indexes must be applied manually since the commands can take significant
amount of time. Since these particular ALTER TABLE commands require an EXCLUSIVE LOCK on the table, it is recommended that
all database activity be quiesced. This means that Ingest and Archive and other Cumulus functions must be shutdown before and during these commands.

The table below from LPDAAC provides the table sizes before and after `alter table` commands, and timings.

| Table Name | Original Table Size | ALTER Run Time (clock) | New Table Size | Number of Rows |
|---|---|---|---|---|
| executions | 1.8 TB | 41 hours | 1.4 TB | 374,170,855 |
| files | 1.2 TB | 7.5 hours | 850 GB | 1,129,847,659 |
| granule_executions | 20 GB | 1 hours | 13 GB | 182,566,709 |

## Tools Used

Since the update commands can take several hours to run based on table size and IO throughput, it is recommended that the commands are run in an EC2 instance
in the AWS environment in a tmux or screen session. This will minimize the number of network hops and potential disconnects between the database client
and the database. In addition, this will allow operators applying the patch to check on progress periodically and not worry about credential expiration or
other issues that would result in the client being killed.

There are many available resources for tmux and the psql client. The following is for your referrence.

- [PostgreSQL Documentation](https://www.postgresql.org/docs/13/app-psql.html)
- [Tmux tutorial](https://www.linuxtrainingacademy.com/tmux-tutorial/)

:::note
The version 9.x psql will be installed. This will work for all our standard SQL but some meta-commands like \d may not work.
:::

Basic commands for running SQL commands

```sh
# Start a tmux session called CumulusUpgrade with a new window named Fix-DataTypes
tmux new -s CumulusUpgrade -n Fix-DataTypes
 
# Start a PosgreSQL client section on the writer instance of the database cluster and prompt for password
psql -h <Endpoint for writer instance> -p <Port for database or 5432> -d <cumulus database name or postgres> -U <database admin user or postgres> -W
  
# Open a new window to use for monitoring
<Ctrl>-b c
 
# Switch between windows
# Last window
<Ctrl>-b l

# Next Window
<Ctrl>-b n
 
# Detach from tmux session
<Ctrl>-b d
 
# List tmux sessions
tmux ls

# Reattach to the session, you will see the windows again
tmux attach -t CumulusUpgrade

# Exit the window and/or close/kill the session
# Warning: Don't close/kill the session until the task is complete
exit
# or
<Ctrl>-b x
```

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

    From AWS console, go to EC2, pick a `<prefix>-CumulusECSCluster` instance, click Connect, click Session Manager.
    :::note Remember to take a note on which instance you run the commands. :::

3. Install tmux and postgres client

    ```sh
    sudo yum install -y tmux postgresql.x86_64
    ```

    Once installed, a tmux session is started with two windows. The Cumulus database is connected to in each window
    using the PostgreSQL client. The primary window is used for running the ALTER commands, while the secondary window
    is used to monitor the database and alter statement. When the operator hits end of shift or is done monitoring for
    the day, the tmux session can be detached from and reattached to at a later time.

4. Run SQL Commands
    The database login credentials can be retrieved from the prefix_db_login secret.

    ```sh
    tmux new-session -s CumulusUpgrade -n Fix-DataTypes

    psql -h <Endpoint for writer instance> -p <Port for database or 5432> -d <cumulus database name> -U <database admin user> -W
    #e.g. psql -h cumulus-dev-rds-cluster.cluster-xxx.us-east-1.rds.amazonaws.com -p 5432 -d cumulus_test_db -U cumulus_test -W

    # Update column types
    ALTER TABLE executions ALTER COLUMN cumulus_id TYPE BIGINT, ALTER COLUMN parent_cumulus_id TYPE BIGINT;
    ALTER TABLE files ALTER COLUMN granule_cumulus_id TYPE BIGINT;
    ALTER TABLE granules_executions ALTER COLUMN granule_cumulus_id TYPE BIGINT, ALTER COLUMN execution_cumulus_id TYPE BIGINT;
    ALTER TABLE pdrs ALTER COLUMN execution_cumulus_id TYPE BIGINT;

    VACUUM (ANALYZE, VERBOSE) executions;
    VACUUM (ANALYZE, VERBOSE) files;
    VACUUM (ANALYZE, VERBOSE) granules_executions;
    VACUUM (ANALYZE, VERBOSE) pdrs;

    # Update and Add indexes
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS granules_collection_cumulus_id_granule_id_unique ON granules(collection_cumulus_id, granule_id);
    CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_granule_id_index ON granules(granule_id);
    CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_provider_collection_cumulus_id_granule_id_index ON granules(provider_cumulus_id, collection_cumulus_id, granule_id);
    ```

5. Monitor the Running Command

    ```text
    # From tmux CumulusUpgrade session, open another window
    <Ctrl>-b c

    psql -h <Endpoint for writer instance> -p <Port for database or 5432> -d <cumulus database name> -U <database admin user> -W

    select pid, query, state, wait_event_type, wait_event from pg_stat_activity where state = 'active';
    ```

6. Close the Session

    Close the tmux session after the task is complete by `exit` or `<Ctrl>-b x`.
