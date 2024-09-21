# ReconciliationReportMigration Lambda

The lambda migrates existing ReconciliationReports data from DynamoDB to PostgreSQL.

To invoke the Lambda and start the ReconciliationReport migration, you can use the AWS Console or CLI:

```bash
aws lambda invoke --function-name $PREFIX-ReconciliationReportMigration $OUTFILE
```

- `PREFIX` is your Cumulus deployment prefix.
- `OUTFILE` (**optional**) is the filepath where the Lambda output will be saved.

The result will be a migration summary. For example:

```
Migration summary:
    Out of 48 DynamoDB records:
    $ 48 records migrated
    $ 1 records skipped
    $ 0 records failed
```
