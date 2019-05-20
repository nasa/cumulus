---
id: version-v1.13.0-move_granules
title: Move Granules
hide_title: true
original_id: move_granules
---

# Move Granules

This task utilizes the Cumulus Message Adapter to interpret and construct incoming and outgoing messages.

Links to the npm package, task input, output and configuration schema definitions and more can be found on the auto-generated [Cumulus Tasks](../tasks) page.

## Summary

This task utilizes the incoming ```event.input``` array of Cumulus [granule](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js) objects to do the following:

* Move granules from their 'staging' location to the final location (as configured in the Sync Granules task)

* Update the ```event.input``` object with the new file locations.

* If the granule has a ECHO10/UMM CMR file(.cmr.xml or .cmr.json) file included in the ```event.input```:
  *  Update that file's access locations
  *  Add it to the appropriate access URL category for the CMR filetype as defined by granule CNM filetype.
  *  Set the CMR file to 'metadata' in the output granules object and add it to  the granule files if it's not already present.

      Please note: **Granules without a valid CNM type set in the granule file type field in ```event.input``` will be treated as 'data' in the updated CMR metadata file**

* Task then outputs an updated list of [granule](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js) objects.

## Task Inputs

### Input

This task expects an incoming input that contains a list of 'staged' S3 URIs to move to their final archive location.  If CMR metadata is to be updated for a granule, it must also be included in the input.

For the specifics, see the [Cumulus Tasks page](../tasks) entry for the schema.

### Configuration

This task does expect values to be set in the CumulusConfig for the workflows.  A schema exists that defines the requirements for the task.

For the most recent config.json schema, please see the [Cumulus Tasks page](../tasks) entry for the schema.

### Input

This task expects event.input to provide an array of Cumulus [granule](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js) objects.   The files listed for each granule represent the files to be acted upon as described in [summary](#summary).

## Task Outputs

This task outputs an assembled array of Cumulus [granule](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js) objects  with post-move file locations as the payload for the next task, and returns only the expected payload for the next task.    If a CMR file has been specified for a granule object, the CMR resources related to the granule files  will be updated according to the updated granule file metadata.

## Examples

See [the SIPS workflow cookbook](../data-cookbooks/sips-workflow) for an example of this task in a workflow
