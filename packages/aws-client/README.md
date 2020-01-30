# @cumulus/aws-client

Utilities for working with AWS. These utilities can be used for interacting with live AWS services or [Localstack][localstack]. For ease of setup, testing, and credential management, code interacting with AWS services should use the helpers in this module.

## Usage

```bash
npm install @cumulus/aws-client
```

## Interacting with Localstack

To use these utilities with [Localstack][localstack], make sure you have a running instance of Localstack and set this environment variable:

```shell
NODE_ENV=test
```

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).

[localstack]: https://github.com/localstack/localstack
