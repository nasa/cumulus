# ReconciliationReportsMigration Lambda

## The lambda migrates existing ReconciliationReports data from DynamoDB to PostgreSQL.

### Running the API
This ReconciliationReportsMigration Lambda is designed to be run manually from your AWS console or CLI as the first step in the data migration process.

The result will be a migration summary. For example:

```
Migration summary:
    Out of 48 DynamoDB records:
    $ 48 records migrated
    $ 1 records skipped
    $ 0 records failed
```
