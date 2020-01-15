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
  list-deployments         List Terraform Cumulus deployments in the account
  deployment-report        List each Cumulus deployment with files, number of resources, and last update date
  list-orphaned-resources  List resources not associated with a Terraform deployment, currently supports ECS and EC2
```

## Assumptions

- Terraform state files are configured for remote state storage in S3 using DynamoDB for locks. Follow the instructions in the [deployment documentation](https://nasa.github.io/cumulus/docs/deployment/deployment-readme#create-resources-for-terraform-state) for proper setup.

- State files keys are in the format: `.*/data-persistence.*/terraform.tfstate` or `.*/cumulus.*/terraform.tfstate`

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
