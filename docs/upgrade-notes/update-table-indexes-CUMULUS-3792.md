---
id: update_table_indexes_CUMULUS_3792
title: Update Table Indexes for CUMULUS-3792
hide_title: false
---

## Background

As part of the ElasticSearch removal efforts, Cumulus API endpoints which previously query ElasticSearch
are being updated to query RDS instead.  New database indexes are required to make RDS queries more efficient.

The updates will be automatically created as part of the bootstrap lambda function on deployment of the data-persistence module.

*In cases where the indexes are already applied, the updates will have no effect. If you have an existing index with the same definition
but a different name than the one we are creating, you can rename your existing index to the new index name.*

## Apply the Changes in Production Environment

With large database (e.g. number of rows in executions table is greater than 100,000), the indexes must be applied manually since
the commands can take significant amount of time and exceeds the bootstrap lambda's 15 minute timeout.

## Tools Used

Since the update commands can take a few hours to run based on table size and IO throughput, it is recommended that the commands are run in an EC2 instance
in the AWS environment in a tmux or screen session. This will minimize the number of network hops and potential disconnects between the database client
and the database. In addition, this will allow operators applying the patch to check on progress periodically and not worry about credential expiration or
other issues that would result in the client being killed.

## Upgrade Steps

1. Login into EC2 instance with database access

    From AWS console: Go to EC2, pick a `<prefix>-CumulusECSCluster` instance, click Connect, click Session Manager
    and click the Connect button.

    From AWS CLI: aws ssm start-session --target `EC2 Instance ID`.

    :::note Remember to take a note on which instance you run the commands.

2. Install tmux and postgres client

    ```sh
    sudo yum install -y tmux
    sudo amazon-linux-extras install postgresql13
    ```

    Once installed, a tmux session is started with two windows. The Cumulus database is connected to in each window
    using the PostgreSQL client. The primary window is used for running the `CREATE INDEX` commands, while the secondary
    window is used to monitor the database and `CREATE INDEX` statement. The tmux session can be detached from and
    reattached to at a later time.

3. Run SQL commands

    The database login credentials can be retrieved from the prefix_db_login secret.
    When the SQL commands are running, perform step 5 to monitor the commands.

    ```sh
    tmux new-session -s CumulusUpgrade -n AddIndexes

    psql -h <Endpoint for writer instance> -p <Port for database or 5432> -d <cumulus database name> -U <database admin user> -W
    #e.g. psql -h cumulus-dev-rds-cluster.cluster-xxx.us-east-1.rds.amazonaws.com -p 5432 -d cumulus_test_db -U cumulus_test -W

    # Use -f option to run the SQL commands from a file, -o option to write output to file
    psql -h <Endpoint for writer instance> -p <Port for database or 5432> -d <cumulus database name> -U <database admin user> -f 20240728101230_add_table_indexes.sql -W
    ```

    The following are SQL commands, and 20240728101230_add_table_indexes.sql is available
    [here](https://raw.githubusercontent.com/nasa/cumulus/master/packages/db/src/migrations/20240728101230_add_table_indexes.sql):

    ```sql
    SELECT CURRENT_TIMESTAMP;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS async_operations_updated_at_index ON async_operations(updated_at);
    SELECT CURRENT_TIMESTAMP;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS async_operations_status_operation_type_cumulus_id_index ON async_operations(status, operation_type, cumulus_id);

    SELECT CURRENT_TIMESTAMP;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS collections_updated_at_index ON collections(updated_at);

    SELECT CURRENT_TIMESTAMP;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS executions_updated_at_index ON executions(updated_at);
    SELECT CURRENT_TIMESTAMP;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS executions_status_collection_cumulus_id_index ON executions(status, collection_cumulus_id, cumulus_id);

    SELECT CURRENT_TIMESTAMP;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS files_updated_at_index ON files(updated_at);

    SELECT CURRENT_TIMESTAMP;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_updated_at_index ON granules(updated_at);
    SELECT CURRENT_TIMESTAMP;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_coll_status_processendtime_cumulus_id_index ON granules(collection_cumulus_id, status, processing_end_date_time, cumulus_id);
    SELECT CURRENT_TIMESTAMP;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_status_provider_collection_cumulus_id_index ON granules(status, provider_cumulus_id, collection_cumulus_id, cumulus_id);

    SELECT CURRENT_TIMESTAMP;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS pdrs_updated_at_index ON pdrs(updated_at);
    SELECT CURRENT_TIMESTAMP;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS pdrs_status_provider_collection_cumulus_id_index ON pdrs(status, provider_cumulus_id, collection_cumulus_id, cumulus_id);
    SELECT CURRENT_TIMESTAMP;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS pdrs_execution_cumulus_id_index ON pdrs(execution_cumulus_id);
    SELECT CURRENT_TIMESTAMP;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS pdrs_coll_status_cumulus_id_index ON pdrs(collection_cumulus_id, status, cumulus_id);
    SELECT CURRENT_TIMESTAMP;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS pdrs_provider_collection_cumulus_id_name_index ON pdrs(provider_cumulus_id, collection_cumulus_id, name);

    SELECT CURRENT_TIMESTAMP;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS providers_updated_at_index ON providers(updated_at);

    SELECT CURRENT_TIMESTAMP;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS rules_updated_at_index ON rules(updated_at);

    SELECT CURRENT_TIMESTAMP;
    VACUUM (ANALYZE, VERBOSE) async_operations;
    SELECT CURRENT_TIMESTAMP;
    VACUUM (ANALYZE, VERBOSE) collections;
    SELECT CURRENT_TIMESTAMP;
    VACUUM (ANALYZE, VERBOSE) executions;
    SELECT CURRENT_TIMESTAMP;
    VACUUM (ANALYZE, VERBOSE) files;
    SELECT CURRENT_TIMESTAMP;
    VACUUM (ANALYZE, VERBOSE) granules;
    SELECT CURRENT_TIMESTAMP;
    VACUUM (ANALYZE, VERBOSE) pdrs;
    SELECT CURRENT_TIMESTAMP;
    VACUUM (ANALYZE, VERBOSE) providers;
    SELECT CURRENT_TIMESTAMP;
    VACUUM (ANALYZE, VERBOSE) rules;
    SELECT CURRENT_TIMESTAMP;
    ```

4. Monitor the running command

    ```sh
    # From tmux CumulusUpgrade session, open another window
    <Ctrl>-b c

    psql -h <Endpoint for writer instance> -p <Port for database or 5432> -d <cumulus database name> -U <database admin user> -W

    select pid, query, state, wait_event_type, wait_event from pg_stat_activity where state = 'active';
    ```

5. Verify the updates

     We can verify that the tables are updated successfully by checking the `\d tablename` results from psql, and the indexes created should be listed.

     If the concurrent index query fails for any reason, you may have an `invalid` index - if this occurs,
     make sure to drop and create the index again to avoid resources being used for the invalid index.

6. Close the session

    Close the tmux session after the task is complete by `exit` or `<Ctrl>-b x`.
