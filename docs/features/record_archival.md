---
id: db_record_archive
title: Database Record Archival
hide_title: false
---

This documentation explains the database record archival and associated functionality.

## Database Record Archive Column

The cumulus database tables "granules" and "executions" contain a field "archived" which is outside of normal data as it contains nothing useful to the end user, but instead is part of query structure to optimize database search.

A granule or execution will by default be false, but once old enough (age set by the DAAC) will be flagged with archived=true.

This makes no material difference to the content or state of the record, but does allow a granule or execution search query to access un-archived records more rapidly and at lower cost by eliminating from consideration a majority of records.

## Cumulus Dashboard Search

The cumulus dashboard, by default, performs searches against granules and executions excluding records that are archived. if necessary, a user can toggle archived searching on in order to look at older records, but accepts a performance hit in doing so.

## Custom Queries

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

The key reason to do this is performance, a search with archived: false will be more performant in most cases than a general search as it allows the query to eliminate old, out of consideration records, more simply and rapidly.

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