---
id: data-migration-to-partitioned-global-unique-tables
title: Data migration to partitioned global unique tables
hide_title: false
---

## Background

The deployment of db patches for
[CUMULUS-4982 Partition files_global_unique and granules_global_unique tables](https://bugs.earthdata.nasa.gov/browse/CUMULUS-4982)
creates the new HASH-partitioned structures and safely renames your active data to *_old_non_partitioned backup tables.
This guide covers how to manually transfer that data, verify it, and clean up the old tables.

## Execution Steps

1. Login into EC2 instance with database access.

    From AWS console: Go to EC2, pick a `<prefix>-CumulusECSCluster` instance, click Connect, click Session Manager
    and click the Connect button.

    From AWS CLI: aws ssm start-session --target `EC2 Instance ID`.

    :::note Remember to take a note on which instance you run the commands.

2. Install tmux, postgres client and python packages

    ```sh
    sudo yum install -y tmux
    sudo dnf install -y postgresql17
    ```

    Once installed, a `tmux` session is started with two windows, the Cumulus database is connected to each window
    using the PostgreSQL client. The primary window is used for running the migration SQL script, while the secondary
    window is used to monitor the database. The tmux session can be detached and reattached later as needed.

3. Run Migration Script

    The database login credentials can be retrieved from the `<prefix>_db_login` secret.
    When the migration script is running, perform step 4 to monitor the commands. The migration script also prints out the progress messages.

    ```sh
    curl -o /home/ssm-user/20260625_migrate_and_verify_global_uniqueness.sql https://raw.githubusercontent.com/nasa/cumulus/master/packages/db/src/migrations/20260625_migrate_and_verify_global_uniqueness.sql

    tmux new-session -s CumulusUpgrade -n migrateGlobalUnique

    psql -h <Endpoint for writer instance> -p <Port for database or 5432> -d <cumulus database name> -U <database admin user> -f /home/ssm-user/20260625_migrate_and_verify_global_uniqueness.sql -W
    #e.g. psql -h cumulus-dev-rds-cluster.cluster-xxx.us-east-1.rds.amazonaws.com -p 5432 -d cumulus_test_db -U cumulus_test -f /home/ssm-user/20260625_migrate_and_verify_global_uniqueness.sql -W
    ```

4. Monitor the Running Command

    ```sh
    # From tmux CumulusUpgrade session, open another window
    <Ctrl>-b c

    psql -h <Endpoint for writer instance> -p <Port for database or 5432> -d <cumulus database name> -U <database admin user> -W

    select pid, query, state, wait_event_type, wait_event from pg_stat_activity where state = 'active';
    ```

5. Close the Session

    Close the tmux session after the task is complete by `exit` or `<Ctrl>-b x`.
