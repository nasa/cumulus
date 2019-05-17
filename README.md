# Cumulus Framework

[![Build Status](https://travis-ci.org/nasa/cumulus.svg?branch=master)](https://travis-ci.org/nasa/cumulus)
[![npm version](https://badge.fury.io/js/%40cumulus%2Fapi.svg)](https://badge.fury.io/js/%40cumulus%2Fapi)
[![Coverage Status](https://coveralls.io/repos/github/nasa/cumulus/badge.svg?branch=master)](https://coveralls.io/github/nasa/cumulus?branch=master)

## 📖 Documentation

- Documentation for the latest [released version](https://nasa.github.io/cumulus).
- Documentation for the [unreleased work](https://nasa.github.io/cumulus/docs/next/cumulus-docs-readme).

Meaningeless doc edit 

## More Information

For more information about this project of more about NASA's Earth Observing System Data and Information System (EOSDIS) and its cloud work, please contact [Katie Baynes](mailto:katie.baynes@nasa.gov) or visit us at https://earthdata.nasa.gov.

# 🔨 Development

## Installation

This is for installation for Cumulus development.  See the [Cumulus deployment instructions](https://nasa.github.io/cumulus/docs/deployment/deployment-readme) for instructions on deploying the released Cumulus packages.

### Prerequisites

- [NVM](https://github.com/creationix/nvm) and node version 8.
- [AWS CLI](http://docs.aws.amazon.com/cli/latest/userguide/installing.html)
- BASH
- Docker (only required for testing)
- docker-compose (only required for testing `pip install docker-compose`)

Install the correct node version:

```bash
nvm install
nvm use
```

### Install Lerna

We use Lerna to manage multiple Cumulus packages in the same repo. You need to install lerna as a global module first:

    $ npm install -g lerna

### Install Local Dependencies

We use npm for local package management

    $ npm install
    $ npm run bootstrap

Building All packages:

    $ npm run build

Build and watch packages:

    $ npm run watch

## Running the Cumulus APIs locally

Start localstack:

    $ docker-compose up local

Start the API:

    $ npm run serve

Or start the distribution API:

    $ npm run serve-dist

See the [API package documentation](packages/api/README.md#running-the-api-locally) for more options.

## 📝 Tests

### Unit Tests

#### LocalStack

[LocalStack](https://github.com/localstack/localstack) provides local versions of most AWS services for testing.

The LocalStack repository has [installation instructions](https://github.com/localstack/localstack#installing).

Localstack is included in the docker-compose file. You only need to run the docker-compose command in the next section in order to use it with your tests.

#### Docker containers

Turn on the docker containers first:

    $ docker-compose up local

If you prefer to run docker in detached mode (i.e. run containers in the background), run:

    $ docker-compose up -d local

#### Run tests

Run the test commands next

    $ export LOCALSTACK_HOST=localhost
    $ npm test

### Integration Tests

For more information please [read this](docs/development/integration-tests.md).

## 🔦 Code Coverage and Quality

For more information please [read this](docs/development/quality-and-coverage.md).

## 📦 Adding New Packages

Create a new folder under `packages` if it is a common library or create folder under `cumulus/tasks` if it is a lambda task. `cd` to the folder and run `npm init`.

Make sure to name the package as `@cumulus/package-name`.

## Running command in all package folders

    $ lerna exec -- rm -rf ./package-lock.json

## Cleaning Up all the repos

    $ npm run clean

## Contribution

Please refer to: https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md for more information.

## 🛒 Release

To release a new version of cumulus [read this](docs/development/release.md).
