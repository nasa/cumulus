---
id: files_to_granules
title: Files To Granules
hide_title: true
---

# Files To Granules

This task utilizes the Cumulus Message Adapter to interpret and construct incoming and outgoing messages.

Links to the npm package, task input, output and configuration schema definitions and more can be found on the auto-generated [Cumulus Tasks](../tasks) page.

## Summary

This task utilizes the incoming ```config.inputGranules``` and the task input list of s3 URIs along with the rest of the configuration objects to take the list of incoming files and sort them into a list of granule objects.

  **Please note** Files passed in without metadata defined previously for ```config.inputGranules``` will be added with the following keys:

* name
* bucket
* filename
* fileStagingDir

It is primarily intended to support compatibility with the standard output of a processing task, and convert that output into a granule object accepted as input by the majority of other Cumulus tasks.

## Task Inputs

### Input

This task expects an incoming input that contains an array  of 'staged' S3 URIs to move to their final archive location.

For the specifics, see the [Cumulus Tasks page](../tasks) entry for the schema.

### Configuration

This task does expect values to be set in the CumulusConfig for the workflows.  A schema exists that defines the requirements for the task.

For the most recent config.json schema, please see the [Cumulus Tasks page](../tasks) entry for the schema.

Below are expanded descriptions of selected config keys:

#### inputGranules

An array of Cumulus [granule](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js) objects.

This object will be used to define metadata values for the move granules task, and is the basis for the updated object that will be added to the output.

## Task Outputs

This task outputs an assembled array of Cumulus [granule](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js) objects as the payload for the next task, and returns only the expected payload for the next task.