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
