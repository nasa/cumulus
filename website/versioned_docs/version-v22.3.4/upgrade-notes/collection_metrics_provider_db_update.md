---
id: collection-metrics_provider-db-update
title: Update collection schema to include metrics_provider
hide_title: false
---

## Background

the updated Collection db model can be found [here](https://github.com/nasa/cumulus/blob/master/packages/db/src/types/collection.ts)

the metrics_provider field distinguishes the data metrics_provider which can be used to differentiate metrics stack on a per-collection basis. This field cannot be null, but this presents a problem for existing databases, where collections already exist. as a result an update must be run manually.

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
    sudo amazon-linux-extras install postgresql17
    # Amazon Linux 2023
    sudo dnf install -y postgresql17
    ```

    Once installed, a tmux session is started with two windows, the Cumulus database is connected to each window
    using the PostgreSQL client. The primary window is used for running the `CREATE INDEX` commands, while the secondary
    window is used to monitor the database and `CREATE INDEX` statement. The tmux session can be detached from and
    reattached to at a later time.

3. Run SQL commands

    The database login credentials can be retrieved from the prefix_db_login secret.
    When the SQL commands are running, perform step 5 to monitor the commands.

    ```sh
    tmux new-session -s CumulusUpgrade -n metricsProvider

    psql -h <Endpoint for writer instance> -p <Port for database or 5432> -d <cumulus database name> -U <database admin user> -W
    #e.g. psql -h cumulus-dev-rds-cluster.cluster-xxx.us-east-1.rds.amazonaws.com -p 5432 -d cumulus_test_db -U cumulus_test -W
    ```

    The following are the relevant SQL commands.

    ```sql
    ALTER TABLE collections ADD COLUMN IF NOT EXISTS metrics_provider TEXT;
    ```

    This is not the correct final state of the database, as metrics_provider should not be nullable. from here the table should be updated to set the metrics_provider value to the correct value. correct values will need to be understood by talking to DAACS and metrics, but in all but PODAAC and ASF, the collections relevant to those daacs should have metrics_provider=cmr_provider

    once this value is set across the board:

    ```sql
    ALTER TABLE collections ALTER COLUMN metrics_provider SET NOT NULL;
    ```

4. Monitor the running command

    ```sh
    # From tmux CumulusUpgrade session, open another window
    Ctrl-b c

    psql -h <Endpoint for writer instance> -p <Port for database or 5432> -d <cumulus database name> -U <database admin user> -W

    select pid, query, state, wait_event_type, wait_event from pg_stat_activity where state = 'active';
    ```

    These commands should take only minutes, even on large databases.

5. Verify the updates

     We can verify that the tables are updated successfully by checking the `\d collections` results from psql, the column "metrics_provider" should now appear.

     If the concurrent index query fails for any reason, you may have an `invalid` index - if this occurs,
     make sure to drop and create the index again to avoid resources being used for the invalid index.

6. Close the session

    Close the tmux session after the task is complete by `exit` or `Ctrl-b x`.

## DB Migration notes

During migration of collections over to the consolidated db, or any other migration from a db without this column over to a db with this column, there will need to be a metrics_provider added.
