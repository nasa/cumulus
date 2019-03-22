---
id: parse_pdr
title: Parse PDR
hide_title: true
---

# Parse PDR

This task utilizes the Cumulus Message Adapter to interpret and construct incoming and outgoing messages.

Links to the npm package, task input, output and configuration schema definitions and more can be found on the auto-generated [Cumulus Tasks](../tasks) page.

## Summary

The purpose of this task is to do the following with the incoming PDR object:

* Stage it to an internal S3 bucket

* Parse the PDR

* Archive the PDR and remove the staged file if successful

* Outputs a payload object containing metadata about the parsed PDR (e.g. total size of all files, files counts, etc) and a granules object

The constructed granules object is created using PDR metadata to determine values like data type and version, collection definitions to determine a file storage location based on the extracted data type and version number.

Granule file fileTypes are converted from the PDR spec types to CNM types according to the following translation table:

```
  HDF: 'data',
  'HDF-EOS': 'data',
  SCIENCE: 'data',
  BROWSE: 'browse',
  METADATA: 'metadata',
  BROWSE_METADATA: 'metadata',
  QA_METADATA: 'metadata',
  PRODHIST: 'qa',
  QA: 'metadata',
  TGZ: 'data',
  LINKAGE: 'data'
```

Files missing file types will have none assigned, files with invalid types will result in a PDR parse failure.

## Task Inputs

### Input

This task expects an incoming input that contains name and path information about the PDR to be parsed.   For the specifics, see the [Cumulus Tasks page](../tasks) entry for the schema.

### Configuration

This task does expect values to be set in the CumulusConfig for the workflows.  A schema exists that defines the requirements for the task.

For the most recent config.json schema, please see the [Cumulus Tasks page](../tasks) entry for the schema.

Below are expanded descriptions of selected config keys:

#### Provider

A Cumulus [provider](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js) object.  Used to define connection information for retrieving the PDR.

#### Bucket

Defines the bucket where the 'pdrs' folder for parsed PDRs will be stored.

#### Collection

A Cumulus [collection](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js) object.    Used to define granule file groupings and granule metadata for discovered files.

## Task Outputs

This task outputs a single payload output object containing metadata about the parsed PDR (e.g. filesCount, totalSize, etc), a pdr object with information for later steps and a the generated array of [granule](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js) objects.

## Examples

See [the SIPS workflow cookbook](../data-cookbooks/sips-workflow) for an example of this task in a workflow
