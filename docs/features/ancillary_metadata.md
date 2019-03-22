---
id: ancillary_metadata
title: Ancillary Metadata Export
hide_title: true
---

# Ancillary Metadata Export

This feature utilizes the fileType key on a files object in a Cumulus [granule](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js).  It uses the key  to provide a mechanism where granule discovery, processing and other tasks can set and use this value to facilitate metadata export to CMR.

## Tasks setting fileType

### [Discover Granules](../workflow_tasks/discover_granules)
  Uses the Collection fileType key to set the value for files on discovered granules in it's output.

### [Parse PDR](../workflow_tasks/parse_pdr)
  Uses a task-specific mapping to map PDR 'FILE_TYPE' to a CNM type to set fileType on granules from the PDR.

### CNMToCMALambdaFunction
  Natively supports fileTypes that are included in incoming messages to a [CNM Workflow](data-cookbooks/cnm-workflow).

## Tasks using fileType

### [Move Granules](../workflow_tasks/move_granules)
  Uses the granule file fileType key to update UMM/ECHO 10 CMR files passed in as candidates to the task.   This task adds the external facing URLs to the CMR metadata file based on the fileType.

  If a non CNM fileType is specified, the task assumes it is a 'data' file.
