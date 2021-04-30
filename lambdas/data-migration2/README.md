# Data Migration 2 Lambda

The data-migration2 lambda is the second of two Lambdas to be run in order to migrate existing DynamoDB data to PostgreSQL.

### Running the API
This second Lambda in the data migration process can be by invoking an async operation using the provided `${PREFIX}-postgres-migration-async-operation` lambda and invoking from the AWS console or command line.

For more information, see [README](../../lambdas/postgres-migration-async-operation/README.md)

The resources migrated in Data Migration 2 are:

- Executions
- PDRs
- Granules
- Files

The result will be a migration summary object.

Records skipped indicates if a record was already migrated (which the lambda will throw with a `RecordAlreadyMigrated` error.)

For `executions`, `granules`, and `files`, all data migration error messages will be written to JSON files:

- `data-migration2-execution-errors-${timestamp}.json` and
- `data-migration2-granulesAndFiles-errors-${timestamp}.json`

and uploaded to S3 to your configured system bucket at `${prefix}/data-migration2-${type}-errors-${timestamp}.json`.
