# Cumulus Framework

[![npm version](https://badge.fury.io/js/%40cumulus%2Fapi.svg)](https://badge.fury.io/js/%40cumulus%2Fapi)
[![Coverage Status](https://coveralls.io/repos/github/nasa/cumulus/badge.svg?branch=master)](https://coveralls.io/github/nasa/cumulus?branch=master)

## About Cumulus
Cumulus is an open source cloud-based data ingest, archive, distribution, and management framework developed for NASA's future Earth Science data streams. This repo supports the development, deployment, and testing of Cumulus and supplies useful tips on configuration, workflow management, and operations. 
To learn more about Cumulus and NASA's Earth Observing System Data and Information System (EOSDIS) cloud initiatives go to [More Information](#more-information).

---

# 🚀 Getting Started

Below is in-depth guidance to help get you started with your Cumulus development. To get a quick start on Cumulus deployment go to our [Getting Started](https://nasa.github.io/cumulus/docs/cumulus-docs-readme) section.

## Contents
- [Documentation](#📖-documentation)
- [Development](#🔨-development)
    - [Installation](#installation)
        - [Prerequisites](#prerequisites)
        - [Install Lerna](#install-lerna)
        - [Install Local Dependencies](#install-local-dependencies)
    - [Running the Cumulus APIs Locally](#running-the-cumulus-apis-locally)
    - [Tests](#📝-tests)
        - [Unit Tests](#unit-tests)
            -[LocalStack](#localstack)
        - [Integration Tests](#integration-tests)
        - [Running Tests via VS Code Debugger](#running-tests-via-vs-code-debugger)
    - [Code Coverage And Quality](#🔦-code-coverage-and-quality)
    - [Adding New Packages](#📦-adding-new-packages)
    - [Cleaning Up All The Repos](#cleaning-up-all-the-repos)
    - [Contribution](#contribution)
    - [Release](#🛒-release)
- [More Information](#more-information)

---

## 📖 Documentation

- Documentation for the latest [released version](https://nasa.github.io/cumulus).
- Documentation for the [unreleased work](https://nasa.github.io/cumulus/docs/next/cumulus-docs-readme).

# 🔨 Development

The Cumulus core repo is a [monorepo](https://en.wikipedia.org/wiki/Monorepo)
managed by [Lerna](https://lerna.js.org/). Lerna is responsible for installing
the dependencies of the packages and tasks that belong in this repo. In general,
Cumulus's npm packages can be found in the [packages](./packages) directory, and
workflow tasks can be found in the [tasks](./tasks) directory.

To help cut down on the time and disk space required to install the dependencies
of the packages in this monorepo, all `devDependencies` are defined in the
top-level [package.json](./package.json). The
[Node module resolution algorithm](https://nodejs.org/api/modules.html#modules_loading_from_node_modules_folders)
allows all of the packages and tasks to find their dev dependencies in that
top-level `node_modules` directory.

TL;DR - If you need to add a `devDependency` to a package, add it to the
top-level [package.json](./package.json) file, not the `package.json` associated
with an individual package.

## Installation

This is for installation for Cumulus development. See the [Cumulus deployment section](https://nasa.github.io/cumulus/docs/deployment/deployment-readme) for instructions on deploying the released Cumulus packages.

### Prerequisites

- [NVM](https://github.com/creationix/nvm) and node version 14.19.1
- [AWS CLI](http://docs.aws.amazon.com/cli/latest/userguide/installing.html)
- Bash
- [Docker](https://www.docker.com/) (only required for testing)
- docker-compose (only required for testing `pip install docker-compose`)
- Python 3.7
- [pipenv](https://pypi.org/project/pipenv/)

> You may use `brew` to install the prerequisites. Visit [Homebrew documentation](https://brew.sh/) for guidance.

Install the correct node version:

```bash
nvm install
nvm use
```

### Install Lerna

We use Lerna to manage multiple Cumulus packages in the same repo. You need to install Lerna as a global module first:

    $ npm install -g lerna

### Install Local Dependencies

We use npm for local package management. Run the following to get your dependencies set up.

    $ npm install
    $ npm run bootstrap

Build all packages:

    $ npm run build

Build and watch packages:

    $ npm run watch

To add new packages go to [Adding New Packages](#📦-adding-new-packages) for guidance.

## Running the Cumulus APIs locally

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

    $ npm run start-unit-test-stack

Stop localstack/unit test services:

    $ npm run stop-unit-test-stack

#### Run database migrations

```
$ npm run db:local:migrate
```

#### Run tests

Run the test commands next
```
    $ export LOCAL_ES_HOST=127.0.0.1
    $ export LOCALSTACK_HOST=127.0.0.1
    $ npm test
```

### Integration Tests

For more information please [read this](docs/development/integration-tests.md).

### Running tests via VS Code debugger

Copy the `.vscode.example` directory to `.vscode` to create your debugger launch configuration. Refer to the [VS Code documentation on how to use the debugger](https://code.visualstudio.com/docs/editor/debugging).

## 🔦 Code Coverage and Quality

For more information please [read this](docs/development/quality-and-coverage.md).

## 📦 Adding New Packages

Create a new folder under `packages` if it is a common library or create folder under `cumulus/tasks` if it is a lambda task. `cd` to the folder and run `npm init`.

Make sure to name the package as `@cumulus/package-name`.

## Running command in all package folders

    $ lerna exec -- rm -rf ./package-lock.json

## Cleaning Up all the repos

    $ npm run clean

---

## Contribution

Please refer to: https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md for more information.

## 🛒 Release

To release a new version of cumulus [read this](docs/development/release.md).

---

## More Information

For more information about this project or more about NASA's Earth Observing System Data and Information System (EOSDIS) and its cloud work, please contact [Katie Baynes](mailto:katie.baynes@nasa.gov) or visit us at https://earthdata.nasa.gov.
