# @cumulus/pdr-status-check

Lambda function handler for checking the status of a workflow (step function) execution. Expects a payload object which includes the name of a PDR.
The concurrency of SFN API calls is set to 10 by default, and it's configurable by setting the Lambda environment variable CONCURRENCY.

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
