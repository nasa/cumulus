---
id: add_and_index_archived_column
title: Add and Index Archived Column
---

## Background

To optimize record searching we are adding a boolean column to archive granules and executions records. these should be btree indexed, adding very little additional size to the database while allowing us to better make the most common queries from the database: getting the most recent records according to a search query.

## Apply Changes in Production Environment

With a large database (e.g. any daac production database), these columns and indices should be applied manually to ensure lambda timeouts are not exceeded

## Tools Used

Since the update commands can take a few hours to run based on table size and IO throughput, it is recommended that the commands are run in an EC2 instance
in the AWS environment in a tmux or screen session. This will minimize the number of network hops and potential disconnects between the database client
and the database. Additionally, this will allow operators applying the patch to check on progress periodically and not worry about credential expiration or
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
    # Amazon Linux 2
    sudo amazon-linux-extras install postgresql13
    # Amazon Linux 2023
    sudo dnf install -y postgresql15
    ```

    Once installed, a tmux session is started with two windows, the Cumulus database is connected to each window
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
    psql -h <Endpoint for writer instance> -p <Port for database or 5432> -d <cumulus database name> -U <database admin user> -f 20250617190412_add_archived_and_index.sql -W
    ```

    The following are SQL commands, and  20250617190412_add_archived_and_index.sql is available
    [here](https://raw.githubusercontent.com/nasa/cumulus/master/packages/db/src/migrations/ 20250617190412_add_archived_and_index.sql):

    ```sql
ALTER TABLE granules ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE granules ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX CONCURRENTLY IF NOT EXISTS executions_archived_index ON executions (archived);
CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_archived_index ON granules (archived);
    ```

4. Monitor the running command

    ```sh
    # From tmux CumulusUpgrade session, open another window
    Ctrl-b c

    psql -h <Endpoint for writer instance> -p <Port for database or 5432> -d <cumulus database name> -U <database admin user> -W

    select pid, query, state, wait_event_type, wait_event from pg_stat_activity where state = 'active';
    ```

5. Verify the updates

     We can verify that the tables are updated successfully by checking the `\d tablename` results from psql, the indexes created should be listed.

     If the concurrent index query fails for any reason, you may have an `invalid` index - if this occurs,
     make sure to drop and create the index again to avoid resources being used for the invalid index.

6. Close the session

    Close the tmux session after the task is complete by `exit` or `Ctrl-b x`.
