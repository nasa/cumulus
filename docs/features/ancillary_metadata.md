---
id: ancillary_metadata
title: Ancillary Metadata
hide_title: true
---

# Ancillary Metadata Export

This feature utilizes the files object in a Cumulus granule input to various tasks to provide a mechanism where granule discovery, processing and other tasks can set and use this value to facilitate metadata export to CMR.

The following tasks set fileType values on the granules they output:

* [Discover Granules](../workflow_tasks/discover_granules)
  Uses the Collection fileType key to set the value for files on discovered granules.
* [Parse PDR](../workflow_tasks/parse_pdr)
  Uses a task-specific mapping to map PDR 'FILE_TYPE' to a CNM type to set fileType on granules from the PDR.
* CNMToCMALambdaFunction natively supports fileTypes that are included in incoming messages to a [CNM Workflow](data-cookbooks/cnm-workflow).

The following tasks use/update this to generate CMR metadata:

* [Move Granules](../workflow_tasks/move_granules)
  Uses the granule file fileType key to update UMM/ECHO 10 CMR files passed in as candidates to the task.   This task adds the external facing URLs to the CMR metadata file based on the fileType.

  If a non CNM fileType is specified, the task assumes it is a 'data' file.
