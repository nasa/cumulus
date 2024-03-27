# Migration Helper Async Operation Lambda

This lambda invokes an asynchronous operation which starts an ECS task to run the lambda
based on the operationType.

To invoke the lambda, you can use the AWS Console or CLI:

```shell
aws lambda invoke --function-name ${PREFIX}-migrationHelperAsyncOperation --payload $(echo '{"operationType": "DLA Migration"}' | base64) $OUTFILE
```

where `${PREFIX}` is your Cumulus deployment prefix.
