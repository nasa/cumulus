---
id: update-task-file-schemas
title: Updates to task granule file schemas
hide_title: false
---

## Background

Most Cumulus workflow tasks expect as input a payload of granule(s) which contain the files for each granule. Most tasks also return this same granule structure as output.

However, up to this point, there was inconsistency in the schemas for the granule `files` objects expected by each task. Furthermore, there was no guarantee of consistency between granule `files` objects as stored in the database and the expectations of any given workflow task.

Thus, when performing bulk granule operations which pass granules from the database into a Cumulus workflow, it was possible for there to be schema validation failures depending on which task was used to start the workflow and its particular schema.

In order to rectify this situation, [CUMULUS-2388](https://bugs.earthdata.nasa.gov/browse/CUMULUS-2388) was filed and addressed to create a common granule files schema between nearly all of the Cumulus tasks (exceptions discussed below) and the Cumulus database. The following documentation explains the manual changes you need to make to your deployment in order to be compatible with the updated files schema.

## Updated files schema

The updated granule files schema [can be found here](https://github.com/nasa/cumulus/blob/master/packages/schemas/files.schema.json).

These former properties were deprecated (with notes about how to derive the same information from the updated schema, if possible):

- `filename` - concatenate the `bucket` and `key` values with a directory separator (`/`)
- `name` - use `fileName` property
- `etag` - ETags are no longer provided as an individual file property. Instead, a separate `etags` object mapping S3 URIs to ETag values is provided as output from the following workflow tasks (guidance on how to integrate this output with your workflows is provided in the [Upgrading your workflows](#upgrading-your-workflows) section below):
  - `update-granules-cmr-metadata-file-links`
  - `hyrax-metadata-updates`
- `fileStagingDir` - no longer supported
- `url_path` - no longer supported
- `duplicate_found` - This property is no longer supported, however `sync-granule` and `move-granules` now produce a separate `granuleDuplicates` object as part of their output. The `granuleDuplicates` object is a map of granules by granule ID which includes the files that encountered duplicates during processing. [Guidance on how to integrate `granuleDuplicates` information into your workflow configuration is provided below](#optional---integrate-granuleduplicates-information).

## Exceptions

These workflow tasks did not have their schema for granule files updated:

- `discover-granules` - no updates
- `queue-granules` - no updates
- `parse-pdr` - no updates
- `sync-granule` - input schema not updated, output schema was updated

The reason that these task schemas were not updated is that all of these tasks start before the files have been ingested to S3, thus much of the information that is required in the updated files schema like `bucket`, `key`, or `checksum` is not yet known.

### Bulk granule operations

Since the input schema for the above tasks was not updated, that means you cannot run bulk granule operations against workflows **if they start with any of those tasks**. Bulk granule operations work by loading the specified granules from the database and sending them as input to a specified workflow, so if the specified workflow begins with a task whose input schema does not conform to what is coming out of the database, there will be schema errors.

## Upgrading your deployment

### Upgrading your workflows

### `update-granules-cmr-metadata-file-links`

For any workflows using the `update-granules-cmr-metadata-file-links` task before the `hyrax-metadata-updates` and/or `post-to-cmr` tasks, update the step definition for `update-granules-cmr-metadata-file-links` as follows:

```hcl
    "UpdateGranulesCmrMetadataFileLinksStep": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "buckets": "{$.meta.buckets}",
            "distribution_endpoint": "{$.meta.distribution_endpoint}",
            "cumulus_message": {
              "outputs": [
                {
                  "source": "{$.etags}",
                  "destination": "{$.meta.file_etags}"
                },
                {
                  "source": "{$}",
                  "destination": "{$.payload}"
                }
              ]
            }
          }
        }
      },
      ...more configuration...
```

#### `hyrax-metadata-updates`

For any workflows using the `hyrax-metadata-updates` task before a `post-to-cmr` task, update the definition of the `hyrax-metadata-updates` step as follows:

```hcl
    "HyraxMetadataUpdatesTask": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "ReplaceConfig": {
            "FullMessage": true
          },
          "task_config": {
            "bucket": "{$.meta.buckets.internal.name}",
            "stack": "{$.meta.stack}",
            "cmr": "{$.meta.cmr}",
            "launchpad": "{$.meta.launchpad}",
            "etags": "{$.meta.file_etags}",
            "cumulus_message": {
              "outputs": [
                {
                  "source": "{$.etags}",
                  "destination": "{$.meta.file_etags}"
                },
                {
                  "source": "{$}",
                  "destination": "{$.payload}"
                }
              ]
            }
          }
        }
      },
      ...more configuration...
```

#### `post-to-cmr`

For any workflows using `post-to-cmr` task after the `update-granules-cmr-metadata-file-links` or `hyrax-metadata-updates` tasks, update the `post-to-cmr` step definition as follows:

```hcl
    "CmrStep": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "ReplaceConfig": {
            "FullMessage": true
          },
          "task_config": {
            "bucket": "{$.meta.buckets.internal.name}",
            "stack": "{$.meta.stack}",
            "cmr": "{$.meta.cmr}",
            "launchpad": "{$.meta.launchpad}",
            "etags": "{$.meta.file_etags}"
          }
        }
      },
      ...more configuration...
```

#### Example workflow

For an example workflow integrating all of these changes, please see our example [ingest and publish workflow](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/ingest_and_publish_granule_workflow.asl.json).

#### Optional - Integrate granuleDuplicates information

**Please note** that the `granuleDuplicates` output is purely **informational** and does not have any bearing on the separate configuration for how duplicates should be handled.

You can include `granuleDuplicates` output from the `sync-granule` or `move-granules` tasks in your workflow messages like so:

```hcl
    "SyncGranule": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            ...other config...
            "cumulus_message": {
              "outputs": [
                {
                  "source": "{$.granuleDuplicates}",
                  "destination": "{$.meta.sync_granule.granule_duplicates}"
                },
                {
                  "source": "{$}",
                  "destination": "{$.payload}"
                }
              ]
            }
          }
        }
      }
      ...more configuration...
```

The result of this configuration is that the `granuleDuplicates` output from `sync-granule` would be placed in `meta.sync_granule.granule_duplicates` on the workflow message and remain there throughout the rest of the workflow. The same configuration could be replicated for the `move-granules` task, but be sure to use a different `destination` in the workflow message for the `granuleDuplicates` output .

### Updating collection URL path templates

[Collections can specify `url_path` templates to dynamically generate the final location of files](../workflows/workflow-configuration-how-to#using-a-template-for-file-placement). As part of `url_path` templates, file object properties can be interpolated to generate the file path. Thus, these `url_path` templates need to be updated to ensure that they are compatible with the updated files schema and the properties that will actually be available on file objects.

See the notes on the [updated files schema](#updated-files-schema) to know which properties are available and which previously existing properties were deprecated.

As an example, you will want to update any `url_path` properties in your collections to remove references to `file.name` and replace them with references to `file.fileName` like so:

```diff
- "url_path": "{cmrMetadata.CollectionReference.ShortName}___{cmrMetadata.CollectionReference.Version}/{substring(file.name, 0, 3)}",
+ "url_path": "{cmrMetadata.CollectionReference.ShortName}___{cmrMetadata.CollectionReference.Version}/{substring(file.fileName, 0, 3)}",
```
