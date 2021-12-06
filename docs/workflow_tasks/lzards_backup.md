---
id: lzards_backup
title: LZARDS Backup
hide_title: false
---

The LZARDS backup task takes an array of granules and initiates backup requests to the LZARDS API, which will be handled asynchronously by LZARDS.

## Deployment

The LZARDS backup task is not automatically deployed with Cumulus. Rather, in order to deploy the task through the Cumulus module, you must specify a `lzards_launchpad_passphrase` in your terraform variables. Additionally, ensure that you are passing that variable by ensuring that the Cumulus module has the following input value configuration:

```
lzards_launchpad_passphrase  = var.<launchpad_passphrase_variable_name>
```

In short, deploying the LZARDS task requires configuring a passphrase and ensuring that your TF configuration passes that variable into the Cumulus module.

Additional terraform configuration for the LZARDS task can be found in the Cumulus `ingest` module's `variables.tf`, where the the relevant variables are prefixed with `lzards_`.

## Task Inputs

### Input

This task expects an array of granules as input.

For the specifics, see the [Cumulus Tasks page](../tasks) entry for the schema.

### Configuration

This task does expect values to be set in the `workflow_config` CMA parameters for the workflows.  A schema exists that defines the requirements for the task.

For the most recent config.json schema, please see the [Cumulus Tasks page](../tasks) entry for the schema.

## Task Outputs

### Output

The LZARDS task outputs a composite object containing:
- the input `granules` array, and
- a `backupResults` object that describes the results of LZARDS backup attempts.

For the specifics, see the [Cumulus Tasks page](../tasks) entry for the schema.
