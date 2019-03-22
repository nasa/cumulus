---
id: move_granules
title: Move Granules
hide_title: true
---

# Move Granules

This task utilizes the Cumulus Message Adapter to interpret and construct incoming and outgoing messages.

Links to the npm package, task input, output and configuration schema definitions and more can be found on the auto-generated [Cumulus Tasks](../tasks) page.

## Summary

This task utilizes the incoming ```config.input_granules``` and the task input list of s3 URIs along with the rest of the configuration objects to do the following for a list of files assigned to a single collection:

* Take the list of incoming files and sort them into a list of granule objects.  Assign files to existing granules where appropriate.

* Move granules from their 'staging' location to the final location (as configured in the Sync Granules task)

* Update the ```config.input_granules``` object with the new file locations.

* If the granule has a ECHO10/UMM CMR file(.cmr.xml or .cmr.json) file included in the ```config.input_granules```:
  *  Update that file's access locations
  *  Add it to the appropriate access URL category for the CMR filetype as defined by granule CNM filetype.
  *  Set the CMR file to 'metadata' in the output granules object and add it to  the granule files if it's not already present.

      Please note: **Granules without a valid CNM type set in the granule file fileType field in ```config.input_granules``` will be treated as 'data' in the updated CMR metadata file**

* Task then outputs an updated list of [granule](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js) objects.

## Task Inputs

### Input

This task expects an incoming input that contains a list of 'staged' S3 URIs to move to their final archive location.  If CMR metadata is to be updated for a granule, it must also be included in the input.

For the specifics, see the [Cumulus Tasks page](../tasks) entry for the schema.

### Configuration

This task does expect values to be set in the CumulusConfig for the workflows.  A schema exists that defines the requirements for the task.

For the most recent config.json schema, please see the [Cumulus Tasks page](../tasks) entry for the schema.

Below are expanded descriptions of selected config keys:

#### Input_Granules

An array of Cumulus [granule](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js) objects.

This object will be used to define metadata values for the move granules task, and is the basis for the updated object that will be added to the output.

## Task Outputs

This task outputs an assembled array of Cumulus [granule](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js) objects as the payload for the next task, and returns only the expected payload for the next task.

## Examples

See [the SIPS workflow cookbook](../data-cookbooks/sips-workflow) for an example of this task in a workflow
