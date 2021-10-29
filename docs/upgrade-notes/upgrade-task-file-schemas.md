---
id: upgrade_task_file_schemas
title: Upgrades to task granule file schemas
hide_title: false
---

## Background

Most Cumulus workflow tasks expect as input a payload of granule(s) which contain the files for each granule. Most tasks also return this same granule structure as output.

However, up to this point, there was inconsistency in the schemas for the granule `files` objects expected by each task. Furthermore, there was no guarantee of consistency between granule `files` objects as stored in the database and the expectations of any given workflow task.

Thus, when performing bulk granule operations which pass granules from the database into a Cumulus workflow, it was possible for there to be schema validation failures depending on which task was used to start the workflow and its particular schema.

In order to rectify this situation, [CUMULUS-2388] was filed and addressed to create a common granule files schema between nearly all of the Cumulus tasks (exceptions discussed below). The following documentation explains the manual changes you need to make to your deployment in order to be compatible with the updated files schema.

## Updated files schema

The updated granule files schema [can be found here](https://github.com/nasa/cumulus/blob/master/packages/schemas/files.schema.json).

These former properties were deprecated (with notes about how to derive the same information from the updated schema, if possible):

- `filename` - concatenate the `bucket` and `key` values with a directory separator (`/`)
- `name` - use `fileName` property
- `etag` - ETags are no longer provided as an individual file property. Instead, a separate `etags` object mapping S3 URIs to ETag values is provided as output from the following workflow tasks (guidance on how to integrate this output with your workflows is provided in the [Upgrading your workflows](#upgrading-your-workflows) section below):
  - `update-granules-cmr-metadata-file-links`
  - `hyrax-metadata-updates`
- `fileStagingDir`
- `url_path`
- `duplicate_found`

## Execptions

Two workflow tasks did not have their schema for granule files updated:

- `discover-granules`
-

## Upgrading your deployment

### Upgrading your workflows

For any workflows using the `update-granules-cmr-metadata-file-links` task, update the `Parameters` definition for the step like so:

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

Also, update any steps using the `hyrax-metadata-updates` task as follows:

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

Lastly, update any step definitions using the `post-to-cmr` task to match the following:

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

For an example workflow integrating all of these changes, please see our example [ingest and publish workflow](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/ingest_and_publish_granule_workflow.asl.json).

### Updating collection URL path templates

[Collections can specify `url_path` templates to dynamically generate the final location of files](../workflows/workflow-configuration-how-to#using-a-template-for-file-placement). As part of `url_path` templates, file object properties can be interpolated to generate the file path. Thus, these `url_path` templates need to be updated to ensure that they are compatible with the updated files schema and the properties that will actually be available on file objects.

See the notes on the [updated files schema](#updated-files-schema) to know which properties are available and which previously existing properties were deprecated.

As an example, you will want to update any `url_path` properties in your collections to remove references to `file.name` and replace them with references to `file.fileName` like so:

```diff
- "url_path": "{cmrMetadata.CollectionReference.ShortName}___{cmrMetadata.CollectionReference.Version}/{substring(file.name, 0, 3)}",
+ "url_path": "{cmrMetadata.CollectionReference.ShortName}___{cmrMetadata.CollectionReference.Version}/{substring(file.fileName, 0, 3)}",
```
