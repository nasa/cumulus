# @cumulus/pdr-status-check

[![CircleCI](https://circleci.com/gh/cumulus-nasa/cumulus.svg?style=svg)](https://circleci.com/gh/cumulus-nasa/cumulus)

Lambda function handler for checking the status of a workflow (step function) execution. Expects a payload object which includes the name of a PDR.
The concurrency of SFN API calls is set to 10 by default, and it's configurable by setting the Lambda environment variable CONCURRENCY.

## What is Cumulus?

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://cumulus-nasa.github.io/)

## Contributing

See [Cumulus README](https://github.com/cumulus-nasa/cumulus/blob/master/README.md#installing-and-deploying)
