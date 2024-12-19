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
{"reconciliation_reports":{"total_dynamo_db_records":36,"migrated":36,"failed":0,"skipped":0}}
```
