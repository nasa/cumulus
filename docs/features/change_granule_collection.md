---
id: change_granule_collection
title: Cumulus Change Granule Collections
hide_title: false
---

This documentation explains the process of transitioning granules across collections.

## BulkChangeCollection Api Endpoint

An api endpoint is exposed, along with a function in the @cumulus/api-client.

- api endpoint - POST `/bulkChangeCollection`
- api-client function - `@cumulus/api-client/granules/bulkChangeCollection`

The api-client function accepts the following configurations that specify its targets

- `sourceCollectionId` - specifies the collection *from* which granules should be transfered
- `targetCollectionId` - specifies the collection *to* which granules should be transfered

Additionally the api-client function accepts the following configurations that help bound performance

- `batchSize` - how many granules should be processed in one workflow run
  - default 100
- `concurrency` - processing concurrency
  - default 100
- `s3Concurrency` - processing concurrency specifically for s3 operations that have their own bottleneck values
  - default 50
- `dbMaxPool` - database concurrency. should be greater than or equal to concurrency
  - default 100
- `maxRequestGranules` - maximum number of granules to be handled in one api call
  - default 1000
- `invalidGranuleBehavior` - [`skip`, `error`] what to do if an invalid granule is encountered
  - default `error`
- `cmrGranuleUrlType` - [`s3`, `http`, `both`] granule urls to put into updated cmr record
  - default `both`
- `s3MultipartChunkSizeMb` - chunk size for s3 transfers/writes
  - default from environment

### batchSize

This configuration defines the number of granules to be processed in one workflow run. The Api will load up a random `<batchSize>` batch of granules from the specified collection at `<sourceCollectionId>` and send them through the change-granule-collections workflow.

#### Idempotency and re-running

The intended workflow is that this api is called repeatedly with the same parameters. Each step in the process is tested to be thoroughly idempotent, with the final step in the process* (see below) being the update to postgres. In the event of failures such as cmr failures or other intermitted errors, a granule will will simply be picked up by this call in a future run

- Note that the postgres update is strictly the second to last operation, the final step is to delete old s3 files. It is possible in the specific case that the s3 deletion fails, that that granule will not be re-run and old s3 files can be left over

### concurrency

This configuration defines general parallelization to use. Defaults to 100.

The specific subroutines that run at this concurrency are:

- loading granule records from the cumulus Api
- updating granule records in cumulus datastores (es/postgres)
- updating records in cmr

### s3Concurrency

This configuration defines s3 parallelization to use. Defaults to 50.
Depending on partitioning of s3 buckets, it may or may not be effective to set this higher than 50 as overwhelming s3 with parallel writes will cause it to act dramatically slower than a low concurrency.

The specific subroutines that run at this concurrency are:

- reading s3 records of cmr metadata
- writing updated cmr metadata records to s3
- copying s3 files to new location (if necessary)
- deleting old s3 files (if necessary)

### dbMaxPool

This configuration specifies how many database. Defaults to 100. Connections to allow the process to utilize as part of it's connection pool. This value will constrain database connections, but too low a value can cause performance issues or database write failures (Knex timeout errors) if the connection pool is not high enough to support the set concurrency. Defaults 100, value should target at minimum the value set for `concurrency`.

### maxRequestGranules

This configuration limits the size of requests sent to api endpoints during the runtime of this workflow. Defaults to 1000, minimize overhead from api calls by setting higher, but must be small enough that an api call (primarily the stringified set of granules) does not overrun the limit of 6 Mb that can be passed, and also wont time out the api lambda in attempting to run. How this should be set depends heavily on how many files there are per granule, and what the privateApiLambda timeout is set to.

the specific subroutines that run this maxRequestGranules are.

- `bulkPatch` granule api endpoint
- `bulkPatchGranuleCollection` granule api endpoint

### invalidGranuleBehavior

This configuration specifies how to handle granule records that are un-processable due to containing file records missing either bucket or key. Defaults to `error`, can be either `error` or `skip`. It is of course hoped that these don't exist, but if they do show up it is, by default, expected that this should be taken as a needed fix. If however you wish to process what can be processed and come back to the rest later, they can be skipped.

### cmrGranuleUrlType

This specifies what type of urls to fill out in the cmr metadata as it is updated to the new collection's pathing pattern. Defaults to `both`, can be `both`, `s3`, or `http`.

### s3MultipartChunkSizeMb

This allows you to set the size of chunks that files should be broken up into when loading to s3. This should, in most cases, be left unset, to use the value in your environment based upon the same global configuration that sets this same value elsewhere (i.e. move-granules task) in accordance with your stack's configuration.

## Implementation

The intended use of this is to call this api on a rhythm until it is done. This could be done with a cron job, or another script, but the same api call can be made again and again and by the way it is structured it will get new granules, or reprocess old granules that failed to process the first time.

Multiple api calls should not be run against the same source and target collection ids in parrallel, they should be serialized to repeatedly run batches untill the work is done.

Multiple api calls can be run to parallelize *different* collection moves (unique it both source and target collection id), provided sensible limits are understood with respect to the resources available to your stack.
