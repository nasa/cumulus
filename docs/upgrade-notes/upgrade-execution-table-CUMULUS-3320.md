---
id: upgrade_execution_table_CUMULUS_3320
title: Upgrade execution table to CUMULUS-3320
hide_title: false
---

# Background

As part of the performance/feature evaluation work in completing the update requested as part of CUMULUS-3320, several updates were required to make `executions` table deletes/reads more performant.

These changes required creating new indexes and modifying a table constraint - operations which can take some time and require manual upgrade steps for database deployments where the updates will exceed the bootstrap lambda's 15 minute timeout.

 Please note that testing in a production-similar environment is *strongly* advised if you are concerned about precise query times and/or downtime.

The following procedures detail how this upgrade may be performed:

## Adding the `executions_parent_cumulus_id_index` index

### Reasoning

This index is required to support effective deletion of records. Our query analysis implies the same table foreign-key constraint results in a slow table scan to enforce the constraint for each deletion.

### Procedure

Users may opt to either automatically migrate the database, or manually create the index:

#### Utilize the normal cumulus deployment

The cumulus module will run the migrations on the database when it's deployed.   For databases with smaller holdings and not under heavy load such that the sum of the migrations to be run will complete in < 15 minutes, the migration will run the following SQL query:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS executions_parent_cumulus_id_index ON executions(parent_cumulus_id)'
```

#### Manually create the index

##### Create index with ingest halted:

The recommended approach to create the index is to halt ingest activity that requires write access to the execution table, then run the query to create the index.  This will result in a much faster index operation than attempting to create the index concurrently, however the table will be locked until the index is complete.

For reference, in testing, using a 4ACU Aurora Serverless V1 cluster on a table with 15 million rows this migration took roughly 2 minutes to complete.

To do this, use the following query:

```sql
CREATE INDEX executions_parent_cumulus_id_index ON executions(parent_cumulus_id)'
```

##### Create index concurrently/with ongoing:

The required index can also be created while the database is in use *prior to installing the upgrade containing CUMULUS-3320* by running the following query:

```sql
CREATE INDEX CONCURRENTLY executions_parent_cumulus_id_index ON executions(parent_cumulus_id)'
```

Please note this may take *significantly* longer than creating the index non-concurrently, especially if the table is under heavy use.

#### Indexing Failure

If the concurrent index query fails for any reason, you may have an `invalid` index - if this occurs, make sure to drop and/or recreate the index to avoid resources being used for the invalid index:

```sql
DROP INDEX CONCURRENTLY executions_parent_cumulus_id_index
```

The index operation can then be re-attempted.

## Adding the `executions_collection_cumulus_id_index` index

### Reasoning

This index is required to support effective execution searches by `cumulus_collection_id`

### Procedure

Users may opt to either automatically migrate the database, or manually create the index:

#### Utilize the normal cumulus deployment

The cumulus module will run the migrations on the database when it's deployed.   For databases with smaller holdings and not under heavy load such that the sum of the migrations to be run will complete in < 15 minutes, the migration will run the following SQL query:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS executions_collection_cumulus_id_index ON executions(collection_cumulus_id)
```

#### Manually create the index

##### Create index with ingest halted:

The recommended approach to create the index is to halt ingest activity that requires write access to the execution table, then run the query to create the index.  This will result in a much faster index operation than attempting to create the index concurrently, however the table will be locked until the index is complete.

For reference, in testing, using a 4ACU Aurora Serverless V1 cluster on a table with 15 million rows this migration took roughly 3 minutes to complete.

To do this, use the following query:

```sql
CREATE INDEX executions_collection_cumulus_id_index ON executions(collection_cumulus_id)
```

The required index can also be created while the database is in use *prior to installing the upgrade containing CUMULUS-3320* by running the following query:

```sql
CREATE INDEX CONCURRENTLY executions_collection_cumulus_id_index ON executions(collection_cumulus_id)
```

Please note this may take *significantly* longer than creating the index non-concurrently, especially if the table is under heavy use.

#### Indexing Failure

If the concurrent index query fails for any reason, you may have an `invalid` index - if this occurs, make sure to drop and/or recreate the index to avoid resources being used for the invalid index:

```sql
DROP INDEX CONCURRENTLY executions_collection_cumulus_id_index
```

The index operation can then be re-attempted.

## Updating the `executions_parent_cumulus_id_foreign` constraint

### *Notes*:

- This update may require ingest downtime as updates to the table require some time.   See instructions below.
- This update should be performed after adding the `executions_parent_cumulus_id_foreign` constraint

### Reasoning

This constraint as exists provides no action on deletion, this results in deletion of parent-child execution trees being both onerous and non-performant.   During work/evaluation for the CUMULUS-3320 feature implementation it was determined that adding `ON DELETE SET NULL` to this key makes wholesale/bulk deletes relatively performant (when combined with an index on the field) for large numbers of records while also being acceptable for 3rd party/smaller RESTful queries.

### Procedure

Users may opt to either:

#### Utilize the normal cumulus deployment

The cumulus module will run the migrations on the database when it's deployed.   For databases with smaller holdings and not under heavy load such that the sum of the migrations to be run will complete in < 15 minutes, the migration will run the following SQL query *inside a transaction*.   This query will write-lock the table, which may cause write failures due to timeouts if ingest is ongoing:

```sql
ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_parent_cumulus_id_foreign
ALTER TABLE executions ADD CONSTRAINT executions_parent_cumulus_id_foreign FOREIGN KEY (parent_cumulus_id) REFERENCES executions(cumulus_id) ON DELETE SET NULL';
```

#### Manually update the constraint

To manually update the constraint, do the following, in order:

##### Modify the existing constraint without validation

The following query will, in a transaction, remove the existing constraint and re-enable the updated constraint.   Adding `NOT VALID` to the creation will cause postgres not to validate values in existing rows, but will enforce them for new rows.    This *greatly* reduces downtime requirements as the constraint can be validated while the table is in use, and this transaction should be extremely quick:

```sql
BEGIN;
ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_parent_cumulus_id_foreign;
ALTER TABLE executions ADD CONSTRAINT executions_parent_cumulus_id_foreign FOREIGN KEY (parent_cumulus_id) REFERENCES executions(cumulus_id) ON DELETE SET NULL NOT VALID;
END;
```

#### Re-validate the constraint

This query can be run at any time following the above step and will not lock the full table for new row inserts/selects:

```sql
ALTER TABLE executions VALIDATE CONSTRAINT executions_parent_cumulus_id_foreign
```

For reference, in a table of roughly 18 million records without active ingest running on a Serverless V1 cluster set at 4ACUs, this validation took roughly 2 minutes in repeated testing, however running the validation during simulated active heavy writes it took significantly longer at around 20 minutes.

# Verify the constraint/indexes exist on the table

To validate the upgrades have completed, use one of the following options:

## PSQL terminal

If you're using a PSQL connection to the DB, you can get a full output of table structures and constraints using `\d`:

```sql
\d executions
```

resulting in:

example
```text
some_db=> \d executions
                                                   Table "public.executions"
           Column           |           Type           | Collation | Nullable |                    Default
----------------------------+--------------------------+-----------+----------+------------------------------------------------
 cumulus_id                 | bigint                   |           | not null | nextval('executions_cumulus_id_seq'::regclass)
 arn                        | text                     |           | not null |
 async_operation_cumulus_id | integer                  |           |          |
 collection_cumulus_id      | integer                  |           |          |
 parent_cumulus_id          | bigint                   |           |          |
 cumulus_version            | text                     |           |          |
 url                        | text                     |           |          |
 status                     | text                     |           | not null |
 tasks                      | jsonb                    |           |          |
 error                      | jsonb                    |           |          |
 workflow_name              | text                     |           |          |
 duration                   | real                     |           |          |
 original_payload           | jsonb                    |           |          |
 final_payload              | jsonb                    |           |          |
 timestamp                  | timestamp with time zone |           |          |
 created_at                 | timestamp with time zone |           | not null | CURRENT_TIMESTAMP
 updated_at                 | timestamp with time zone |           | not null | CURRENT_TIMESTAMP
Indexes:
    "executions_pkey" PRIMARY KEY, btree (cumulus_id)
    "executions_arn_unique" UNIQUE CONSTRAINT, btree (arn)
    "executions_collection_cumulus_id_index" btree (collection_cumulus_id)
    "executions_parent_cumulus_id_index" btree (parent_cumulus_id)
    "executions_url_unique" UNIQUE CONSTRAINT, btree (url)
Check constraints:
    "executions_status_check" CHECK (status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text, 'unknown'::text]))
Foreign-key constraints:
    "executions_async_operation_cumulus_id_foreign" FOREIGN KEY (async_operation_cumulus_id) REFERENCES async_operations(cumulus_id)
    "executions_collection_cumulus_id_foreign" FOREIGN KEY (collection_cumulus_id) REFERENCES collections(cumulus_id)
    "executions_parent_cumulus_id_foreign" FOREIGN KEY (parent_cumulus_id) REFERENCES executions(cumulus_id) ON DELETE SET NULL
Referenced by:
    TABLE "executions" CONSTRAINT "executions_parent_cumulus_id_foreign" FOREIGN KEY (parent_cumulus_id) REFERENCES executions(cumulus_id) ON DELETE SET NULL
```

Check that the `executions_parent_cumulus_id_foreign` constraint is present with 'ON DELETE SET_NULL' and does not have 'NOT VALID' appended to the end

Check that the two added indexes `executions_parent_cumulus_id_index` and `executions_collection_cumulus_id_index` exist and do not show as `INVALID`.

## Standard Postgres queries

### Verify executions_parent_cumulus_id_foreign

Run the following query:

```sql
SELECT
    conname AS constraint_name,
    pg_get_constraintdef(pg_constraint.oid) AS definition
FROM
    pg_constraint
WHERE
    conrelid = 'executions'::regclass
    AND contype = 'f';
```

You should get a result like:

```text
                constraint_name                |                                      definition
-----------------------------------------------+--------------------------------------------------------------------------------------
 executions_async_operation_cumulus_id_foreign | FOREIGN KEY (async_operation_cumulus_id) REFERENCES async_operations(cumulus_id)
 executions_collection_cumulus_id_foreign      | FOREIGN KEY (collection_cumulus_id) REFERENCES collections(cumulus_id)
 executions_parent_cumulus_id_foreign          | FOREIGN KEY (parent_cumulus_id) REFERENCES executions(cumulus_id) ON DELETE SET NULL
(3 rows)
```

Check that the `executions_parent_cumulus_id_foreign` constraint is present with 'ON DELETE SET_NULL' and does not have 'NOT VALID' appended to the end


### Verify indexes were created

Run the following query:

```sql
SELECT
    indexname AS index_name,
    indexdef AS definition
FROM
    pg_indexes
WHERE
    tablename = '<tablename>';
```

You should see a result like:

```test
               index_name               |                                                  definition
----------------------------------------+--------------------------------------------------------------------------------------------------------------
 executions_url_unique                  | CREATE UNIQUE INDEX executions_url_unique ON public.executions USING btree (url)
 executions_arn_unique                  | CREATE UNIQUE INDEX executions_arn_unique ON public.executions USING btree (arn)
 executions_pkey                        | CREATE UNIQUE INDEX executions_pkey ON public.executions USING btree (cumulus_id)
 executions_collection_cumulus_id_index | CREATE INDEX executions_collection_cumulus_id_index ON public.executions USING btree (collection_cumulus_id)
 executions_parent_cumulus_id_index     | CREATE INDEX executions_parent_cumulus_id_index ON public.executions USING btree (parent_cumulus_id)
(5 rows)
```

Check that the two added indexes `executions_parent_cumulus_id_index` and `executions_collection_cumulus_id_index` exist and do not show as `INVALID`.

