# Data Migration 2 Lambda

## The second of two Lambdas to be run in order to migrate existing DynamoDB data to PostgreSQL.

### Running the API
This second Lambda in the data migration process can be run in several ways:

1. In an ECS container using the Cumulus ECS Service
2. Directly from the AWS console / command line
3. By invoking an async operation using the provided `${PREFIX}-postgres-migration-async-operation` lambda and invoking from the AWS console or command line.

Running the Lambda within an ECS container is a more common approach as it is likely this execution will take some time. See `/example/data-migration-ecs` for an example container configuration.

The resources migrated in Data Migration 2 are:

- Executions
- PDRs
- Granules
- Files

The result will be a migration summary object.

Records skipped indicates if a record was already migrated (which the lambda will throw with a `RecordAlreadyMigrated` error.)

For `executions`, `granules`, and `files`, all data migration error messages will be written to JSON files `data-migration2-execution-errors-${timestamp}.json` and `data-migration2-granulesAndFiles-errors-${timestamp}.json` and uploaded to S3 to your configured system bucket at `${prefix}/data-migration2-${type}-errors-${timestamp}.json`.
