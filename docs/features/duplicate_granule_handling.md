---
id: duplicate_granule_handling
title: Cumulus Duplicate Granule Handling
hide_title: false
---

Collections and Workflows can be configured to assign a unique `granuleId` to each Granule. This is useful in cases where two Granules share the same `granuleId` but must both be ingested into the Cumulus system. Previously, a Granule with a conflict on the `granuleId` key would cause an ingest failure for that Granule.

## Granule Uniquification
Cumulus has implemented a set of changes that allow multiple Granules with identical `granuleIds` to be ingested and managed independently. This is done by replacing the `granuleId` with a unique value and storing the original `granuleId` value as a new field, `producerGranuleId`. This new `producerGranuleId` field can then be used to track and correlate the Granule to the original data holdings.

### Granule Uniquification Algorithm and Task Component
The process Cumulus Core uses to generate a unique `granuleId` can be [found here](https://github.com/nasa/cumulus/blob/feature/duplicate-granule-924/packages/ingest/src/granule.ts#L479-L487).

To make the process easier, Cumulus Core also provides a Task Component that will uniquely identify each Granule in a payload and return a modified Granule object containing a unique `granuleId` and a `producerGranuleId` containing the original `granuleId`.

## Configuration
### Collection Configuration
Cumulus Collections can be configured to replace the Granule's existing `granuleId` with a unique value. The originnal `granuleId` will then be stored in a new field, `producerGranuleId`.

To configure a Collection to support uniquely identifying Granules, the following params are used in the Collection's JSON:

```
"meta": {
    "uniquifyGranuleId": true,
    "hashLength": 6
  }
```

If `uniquifyGranuleId` is `true` and the Collection is ingested using a workflow that includes the `AddUniqueGranuleId` Task, the `granuleId` will be uniquely generated using the process [here](https://github.com/nasa/cumulus/blob/feature/duplicate-granule-924/packages/ingest/src/granule.ts#L479-L487). The `hashLength` specifies how many characters the randomized hash contains. More characters offer a greater chance of uniqueness.

::important
A Collection that is configured to uniquely identify Granules in this way means that the existing `granuleId` will change to a unique, hashed value. This is important to consider when building workflows and, in particular, specifying the S3 paths for a Granule's Files.

In a Collection configuration, you can specify the `url_path` template that will be used to determine the final location of the Collection's Files. If that path contains a `granuleId` or anything derived from `granuleId`, notably the CMR Metadata's `GranuleUR`, that path will contain the unique value. An example containing the unique `granuleId` might look like:

```
"url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}/{granule.granuleId}",
```
or
```
"url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}/{cmrMetadata.Granule.GranuleUR}",
```

If that is NOT desirable and using the original, non-unique value is preferred, that is still possible. The Collection would need to be configured to use the `producerGranuleId`, which represents the original `granuleId` value without any uniquification, or a completely different value.

```
"url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}/{granule.producerGranuleId}/",
```
::

### Workflow Configuration

TODO in CUMULUS-4079