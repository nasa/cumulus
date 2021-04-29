# Postgres Migration Async Operation Lambda

This lambda invokes an asynchronous operation which starts an ECS task to run the `data-migration2` lambda.

The resources migrated in the `data-migration2` lambda include:

- Executions
- PDRs
- Granules
- Files from Granules.files

To invoke the lambda, you can use the AWS Console or CLI:

```shell
aws lambda invoke --function-name ${PREFIX}-postgres-migration-async-operation
```

where `${PREFIX}` is your Cumulus deployment prefix.