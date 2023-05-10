---
id: lzards_backup
title: LZARDS Backup
hide_title: false
---

The LZARDS backup task takes an array of granules and initiates backup requests to the LZARDS API, which will be handled asynchronously by LZARDS.

:::info 

For more information about LZARDS and the backup process go to the [LZARDS Overview](https://wiki.earthdata.nasa.gov/display/LZARDS/LZARDS+Home).

:::

## Deployment

The LZARDS backup task is not automatically deployed with Cumulus. To deploy the task through the Cumulus module, first you must specify a `lzards_launchpad_passphrase` in your terraform variables (e.g. `variables.tf`) like so:

```hcl
variable "lzards_launchpad_passphrase" {
  type    = string
  default = ""
}
```

Then you can specify a value for your `lzards_launchpad_passphrase` in `terraform.tfvars` like so:

```hcl
lzards_launchpad_passphrase = your-passphrase
```

Lastly, you need to make sure that the `lzards_launchpad_passphrase` is passed into the Cumulus module (in `main.tf`) like so:

```hcl
lzards_launchpad_passphrase  = var.lzards_launchpad_passphrase
```

In short, deploying the LZARDS task requires configuring a passphrase variable and ensuring that your TF configuration passes that variable into the Cumulus module.

Additional terraform configuration for the LZARDS task can be found in the [`cumulus` module's `variables.tf` file,](https://github.com/nasa/cumulus/blob/master/tf-modules/cumulus/variables.tf) where the the relevant variables are prefixed with `lzards_`. You can add these variables to your deployment using the same process outlined above for `lzards_launchpad_passphrase`.

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
