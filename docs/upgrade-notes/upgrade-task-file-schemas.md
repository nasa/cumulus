---
id: upgrade_task_file_schemas
title: Upgrade to task granule file schemas
hide_title: false
---

## Background

Most Cumulus workflow tasks expect as input a payload of granule(s) which contain the files for each granule. Most tasks also return this same granule structure as output.

However, up to this point, there was inconsistency in the schemas for the granule `files` objects expected by each task. Furthermore, there was no guarantee of consistency between granule `files` objects as stored in the database and the expectations of any given workflow task.

Thus, when performing bulk granule operations which pass granules from the database into a Cumulus workflow, it was possible for there to be schema validation failures depending on which task was used to start the workflow and its particular schema.

In order to rectify this situation, [CUMULUS-2388] was filed and addressed to create a common granule files schema between nearly all of the Cumulus tasks (exceptions discussed below). The following documentation explains the manual changes you need to make to your deployment in order to be compatible with the updated files schema.

## Updated files schema

The updated granule files schema [can be found here](https://github.com/nasa/cumulus/blob/CUMULUS-2388-task-schema-consistency/packages/schemas/files.schema.json).

These former properties were deprecated (with notes about how to derive the same information from the updated schema, if possible):

- `filename` - concatenate the `bucket` and `key` values with a directory separator (`/`)
- `name` - use `fileName` property
- `etag` - See [Upgrading your workflows](#upgrading-your-workflows)
- `fileStagingDir`
- `url_path`
- `duplicate_found`

## Upgrading your deployment

### Upgrading your workflows



### Updating collection URL path templates

