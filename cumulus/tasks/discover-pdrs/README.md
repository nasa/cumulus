# @cumulus/discover-pdrs

[![CircleCI](https://circleci.com/gh/cumulus-nasa/cumulus.svg?style=svg)](https://circleci.com/gh/cumulus-nasa/cumulus)

Discover PDRs in FTP/HTTP/SFTP/S3 endpoints
## Message Configuration
### Config

| field name | default | description
| --------   | ------- | ----------
| useQueue   | true    | Whether to add discovered granules to the queue for processing
| provider   | (required) | The cumulus-api provider object
| collection | (required) | The cumulus-api collection object
| bucket     | (required) | The internal bucket name (used for record keeping)
| stack      | (required) | Cumulus deployment stack name
| templateUri | (required)| The S3 Uri to the Cumulus message template of the ParsePdr workflow
| queueUrl   | (required) | The SQS url to the cumulus-api StepFunction Starter Queue

### Input

| field name | default | description
| --------   | ------- | ----------
| N/A        | N/A     | N/A

## What is Cumulus?

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://cumulus-nasa.github.io/)

## Contributing

See [Cumulus README](https://github.com/cumulus-nasa/cumulus/blob/master/README.md#installing-and-deploying)
