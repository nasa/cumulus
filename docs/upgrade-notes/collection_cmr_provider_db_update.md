---
id: collection-cmr-provider-db-update
title: Update collection schema to include cmr_provider
hide_title: false
---

## Background

the updated Collection db model can be found [here](https://github.com/nasa/cumulus/blob/master/packages/db/src/types/collection.ts)

the cmr_provider field now replaces the stack-wide configured cmr provider on a per-collection basis. This field cannot be null, but this presents a problem for existing databases, where collections already exist. as a result an update must be run manually.

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
    tmux new-session -s CumulusUpgrade -n CMRProvider

    psql -h <Endpoint for writer instance> -p <Port for database or 5432> -d <cumulus database name> -U <database admin user> -W
    #e.g. psql -h cumulus-dev-rds-cluster.cluster-xxx.us-east-1.rds.amazonaws.com -p 5432 -d cumulus_test_db -U cumulus_test -W
    ```

    The following are the relevant SQL commands. no sql file is provided to prevent confusion as there's a value that must be configured and not confused. Replace <cmr_provider> with your stack's cmr_provider.

    ```sql
    ALTER TABLE collections ADD COLUMN IF NOT EXISTS cmr_provider TEXT NOT NULL DEFAULT <cmr_provider>
    CREATE INDEX CONCURRENTLY IF NOT EXISTS collections_cmr_provider ON collections (cmr_provider);
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

     We can verify that the tables are updated successfully by checking the `\d tablename` results from psql, the indexes created should be listed.

     If the concurrent index query fails for any reason, you may have an `invalid` index - if this occurs,
     make sure to drop and create the index again to avoid resources being used for the invalid index.

6. Close the session

    Close the tmux session after the task is complete by `exit` or `Ctrl-b x`.

## DB Migration notes

During migration of collections over to the consolidated db, or any other migration from a db without this column over to a db with this column, there will need to be a cmr_provider added.

## Task Onboarding notes

Any task which interacts with the message template will find that meta.cmr.provider is now *null*. any such task will need to be updated to fill that value appropriately. see joinCollectionProviderToTemplateCmrMeta [here](https://github.com/nasa/cumulus/blob/master/packages/ingest/src/queue.js)
