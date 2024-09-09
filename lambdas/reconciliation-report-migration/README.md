# Data Migration 1 Lambda

## The first of two Lambdas to be run in order to migrate existing DynamoDB data to PostgreSQL.

### Running the API
This data-migration1 Lambda is designed to be run manually from your AWS console or CLI as the first step in the data migration process. It will try to migrate all of the following resources to Postgres:

- Async Operations

The result will be a migration summary. For example:

```
Migration summary:
    AsyncOperations:
        Out of 48 DynamoDB records:
        $ 48 records migrated
        $ 1 records skipped
        $ 0 records failed
```
