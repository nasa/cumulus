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

```
Usage: tf-inventory TYPE COMMAND [options]

Options:
  -V, --version            output the version number
  -h, --help               output usage information

Commands:
  list-deployments         List Terraform deployments in the account
  deployment-report        List each deployment with files, number of resources, and last update date
  list-orphaned-resources  List resources not associated with a Terraform deployment
```

This functionality assumes that your Terraform state files are configured for remote state storage in S3 using DynamoDB for locks. Follow the instructions in the [deployment documentation](https://nasa.github.io/cumulus/docs/deployment/deployment-readme#create-resources-for-terraform-state) for proper setup.

Currently for listing orphaned resources, only ECS and EC2 are supported.

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
