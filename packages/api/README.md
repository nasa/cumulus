# @cumulus/api

[![CircleCI](https://circleci.com/gh/cumulus-nasa/cumulus.svg?style=svg)](https://circleci.com/gh/cumulus-nasa/cumulus)

*An API for the Cumulus Framework*

This module build the Cumulus API for the Cumulus framework. It uses a combination of AWS services to create an API interface for configuring, managing and monitoring the Cumulus framework.

For the full documentation of the API see: https://cumulus-nasa.github.io/cumulus-api

### Config
Includes the Kes configuration files needed for the deployment of the Api:
- `config/lambdas.yml`: Includes that Lambdas that do internal Api related tasks such as listening to SNS events or consuming SQS queues
- `config/api_v1.yml`: Includes all the Api endpoints and is versioned. Future versions of the Api should duplicate and rename this file
- `config/distribution.yml`: Includes config needed for the distribution endpoint that handles file downloads with EarthLogin

## What is Cumulus?

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://cumulus-nasa.github.io/)

## Contributing

See [Cumulus README](https://github.com/cumulus-nasa/cumulus/blob/master/README.md#installing-and-deploying)

## Running Tests

Running tests for kinesis-consumer depends on localstack. Once you have installed localstack, you can start it for dynamoDB only:

```
SERVICES=dynamodb localstack start
```

Then you can run tests locally by using node >= 8.0:

```bash
nvm use 8.0
npm run test
```
