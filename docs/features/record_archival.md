---
id: record_archival
title: Database Record Archival
hide_title: false
---

This documentation explains the database record archival and associated functionality.

## Database Record Archive Column

The cumulus database tables "granules" and "executions" contain a field "archived" which is part of query structure to optimize database search.

A granule or execution will by default be `archived=false`, but once old enough (age set by the DAAC) will be flagged with `archived=true`.

This makes no material difference to the content or state of the record, but does allow a granule or execution search query to access un-archived records more rapidly and at lower cost by eliminating from consideration a majority of records.

## Optimized Queries

Queries can be lodged against the api incorporating this column just like any other db record column. For example, a request to list granules (non-archived) might call the cumulus api-client thusly:

```js
const unArchivedGranules = await listGranules({
    prefix: 'my_prefix',
    query: {
        collectionId: 'COLLECTION1',
        archived: false,
        limit: 20,
        sort_key: ['-updated_at']
    }
})
```

This query would ask for the most recent 20 granules from the collection 'COLLECTION1' *which are not archived*.

The key reason to do this is performance, a search with `archived: false` will be more performant in cases where records have been archived and therefore removed from these query results.

## Performance Parameters of Archival

In testing archived queries against substantially large databases there is one key exception to where these searches against un-archived records are more performant, and that is when querying records right up against the temporal border between archived and un-archived records. the inversely sorted search of the above example:

```js
const unArchivedGranules = await listGranules({
    prefix: 'my_prefix',
    query: {
        collectionId: 'COLLECTION1',
        archived: false,
        limit: 20,
        sort_key: ['updated_at']
    }
})
```

will be similar performance or even marginally worse than searching without setting archived: false.

## Archival Cron

There is a pair of api endpoints which are run on a schedule, and archive a batch of either granules or executions older than a certain age. These will run asynchronously and automatically in the background of ingest and should be run at a cadence to keep up with ingest. A slower, more conservative cadence will still be functional, and improve performance, but will fail over time to keep up with archiving *all* old records.

### Configuration

Configuration for this functionality is set in the cumulus tf-module, and is structured as follows:

#### daily_archive_records_schedule_expression

Cron schedule for running the task, using a Cloudwatch cron expression.

Default Value is `"cron(0 4 * * ? *)"`

```tf
daily_archive_records_schedule_expression = "cron(0 * * ? *)"
```

This configuration would set it to run every hour instead

#### archive_update_limit

How many executions and granules to archive in one run of the task function.  This will archive up to <archive_update_limit> granules *and* up to <archive_update_limit> executions. This task function will run in ecs, avoiding uncertainty about time limitations

Default value is 10000.

```tf
archive_update_limit = 300000
```

#### archive_batch_size

Processing batch size, size of individual update calls to Postgres

Default value is 1000.

```tf
archive_batch_size = 3000
```

#### archive_expiration_days

How old a record should be in days before it is archived.

Default value is 365

```tf
archive_expiration_days = 100
```

#### deploy_archive_records_event_rule

Should the eventBridge rule be deployed. setting this to false will cause the archive not to be deployed at all. The api endpoint will still exist and can be called directly, but will not happen automatically.

```tf
deploy_archive_records_event_rule = false
```
