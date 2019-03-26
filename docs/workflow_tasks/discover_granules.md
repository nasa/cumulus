---
id: discover_granules
title: Discover Granules
hide_title: true
---

# Discover Granules

This task utilizes the Cumulus Message Adapter to interpret and construct incoming and outgoing messages.

Links to the npm package, task input, output and configuration schema definitions, and more can be found on the auto-generated [Cumulus Tasks](../tasks) page.

## Summary

The purpose of this task is to facilitate ingest of data that does not conform to either a PDR/[SIPS](../data-cookbooks/sips-workflow) discovery mechanism, a [CNM Workflow](../data-cookbooks/cnm-workflow) or direct injection of workflow triggering events into Cumulus core components.

The task utilizes a defined [collection](../data-cookbooks/setup#collections) in concert with a defined [provider](../data-cookbooks/setup#providers) to scan a location for files matching the defined collection configuration, assemble those files into groupings by granule, and passes the constructed granules object as an output.

The constructed granules object is defined by the collection passed in the configuration, and has impacts to other provided core [Cumulus Tasks](../tasks).

Users of this task in a workflow are encouraged to carefully consider their configuration  in context of downstream tasks and workflows.

## Task Inputs

Each of the following sections are a high-level discussion of the intent of the various input/output/config values.

For the most recent config.json schema, please see the [Cumulus Tasks page](../tasks) entry for the schema.

### Input

This task does not expect an incoming payload.

### Cumulus Configuration

This task does expect values to be set in the CumulusConfig for the workflows.  A schema exists that defines the requirements for the task.

For the most recent config.json schema, please see the [Cumulus Tasks page](../tasks) entry for the schema.

Below are expanded descriptions of selected config keys:

#### Provider

A Cumulus [provider](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js) object.  Used to define connection information for a location to scan for granule discovery.

#### Buckets

A list of buckets with types that will be used to assign bucket targets based on the collection configuration.

#### Collection

A Cumulus [collection](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js) object.    Used to define granule file groupings and granule metadata for discovered files.   The collection object utilizes the collection fileType key to generate fileTypes in the output object on discovery.

## Task Outputs

This task outputs an assembled array of Cumulus [granule](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js) objects as the payload for the next task, and returns only the expected payload for the next task.
