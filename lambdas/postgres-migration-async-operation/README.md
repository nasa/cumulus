# Postgres Migration Async Operation Lambda

This lambda invokes an asynchronous operation which starts an ECS task to run the `data-migration2` lambda.

The resources migrated in the `data-migration2` lambda include:
- Executions
- PDRs
- Granules
- Files
