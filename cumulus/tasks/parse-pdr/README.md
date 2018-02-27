# @cumulus/parse-pdr

[![CircleCI](https://circleci.com/gh/cumulus-nasa/cumulus.svg?style=svg)](https://circleci.com/gh/cumulus-nasa/cumulus)

`@cumulus/parse-pdr` parses a pdr file.

## Message Configuration
### Config

| field name | default | description
| --------   | ------- | ----------
| provider   | (required) | The cumulus-api provider object
| collection | (required) | The cumulus-api collection object
| bucket     | (required) | The internal bucket name (used for record keeping)
| stack      | (required) | Cumulus deployment stack name

### Input

| field name | default | description
| --------   | ------- | ----------
| pdr        | (required) | the PDR object that should include the name and path of the pdr

## What is Cumulus?

Cumulus is a cloud-based data ingest, archive, distribution and management
prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://cumulus-nasa.github.io/)

## Contributing

See [Cumulus README](https://github.com/cumulus-nasa/cumulus/blob/master/README.md#installing-and-deploying)
