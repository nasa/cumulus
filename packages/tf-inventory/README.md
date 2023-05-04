# @cumulus/tf-inventory

@cumulus/tf-inventory provides utilities for monitoring Terraform deployments and resources across an AWS account.

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Installation

```bash
npm install @cumulus/tf-inventory
```

## Command Line Interface

The following utilities are provided via the CLI. For help run `tf-inventory --help`

```bash
Usage: tf-inventory TYPE COMMAND [options]

Options:
  -V, --version                output the version number
  -h, --help                   output usage information

Commands:
  list-deployments [options]   List Terraform Cumulus deployments in the account
  deployment-report [options]  List each Cumulus deployment with files, number of resources, and last update date
  list-orphaned-resources      List resources not associated with a Terraform deployment, currently supports ECS, EC2, and Elasticsearch
```

`list-deployments` and `deployment-report` take an optional `--regex` parameter to specify the regular expression used to extract the deployment name. For example, if state files are stored in the format `bucket/deployment-name/terraform.tfstate`, the regular expression `'.*\/(.*)\/terraform.tfstate'` could be specified to extract the deployment name. Or the regular expression `'(.*)'` could be specified to view all state files as their own deployment.

## Assumptions

- Terraform state files are configured for remote state storage in S3 using DynamoDB for locks. Follow the instructions in the [deployment documentation](https://nasa.github.io/cumulus/docs/deployment/#create-resources-for-terraform-state) for proper setup.

- State files keys are in the format: `.*/data-persistence.*/terraform.tfstate` or `.*/cumulus.*/terraform.tfstate` or an extraction regex is specified for the `list-deployments` and `deployment-report` commands.

## Errors

### `Error extracting deployment name from file ...`

An `Error extracting deployment name` will be printed to the console if a Terraform state file is detected that does not match the specified deployment regular expression, or the default regular expression if none is specified.

### `Error reading <filename>: The specified key does not exist.`

This indicates that there is a Terraform state entry in your DynamoDB locks table pointing to a state file that does not exist. `terraform destroy` empties your state file of resources, but does not remove the file from S3 nor the entry from DynamoDB. It's possible that the state file was manually deleted, but not the DynamoDB entry.

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
