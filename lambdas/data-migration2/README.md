# Data Migration 2 Lambda

## The second of two Lambdas to be run in order to migrate existing DynamoDB data to PostgreSQL.

### Running the API
This second Lambda in the data migration process can be run in two ways:

1. In an ECS container using the Cumulus ECS Service
2. Directly from the AWS console / command line

Running the Lambda within an ECS container is the more common approach as it is likely this execution will take some time. See `/example/data-migration-ecs` for an example container configuration.

The resources migrated in Data Migration 2 are:

- Executions
- PDRs
- Granules
- Files

The result will be a migration summary. For example:

```
Migration summary:
    Executions:
        Out of 1000 DynamoDB records:
        $ 998 records migrated
        $ 1 records skipped
        $ 1 records failed
    PDRs:
        Out of 2987 DynamoDB records:
        $ 2980 records migrated
        $ 6 records skipped
        $ 1 records failed
    Granules:
        Out of 48 DynamoDB records:
        $ 48 records migrated
        $ 0 records skipped
        $ 0 records failed
    Files:
        Out of 27 DynamoDB records:
        $ 26 records migrated
        $ 1 records skipped
        $ 0 records failed
```