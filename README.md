# Cumulus Framework

[![npm version](https://badge.fury.io/js/%40cumulus%2Fapi.svg)](https://badge.fury.io/js/%40cumulus%2Fapi)
[![Coverage Status](https://coveralls.io/repos/github/nasa/cumulus/badge.svg?branch=master)](https://coveralls.io/github/nasa/cumulus?branch=master)

## About Cumulus
Cumulus is an open source cloud-based data ingest, archive, distribution, and management framework developed for NASA's future Earth Science data streams. This repo supports the development, deployment, and testing of Cumulus and supplies useful tips on configuration, workflow management, and operations.
To learn more about Cumulus and NASA's Earth Observing System Data and Information System (EOSDIS) cloud initiatives go to [More Information](#more-information).

---

# 🚀 Getting Started

Below is in-depth guidance to help get you started with your Cumulus development. To get a quick start on Cumulus deployment go to our [Getting Started](https://nasa.github.io/cumulus/docs/) section.

## Contents
- [Documentation](#-documentation)
- [Development](#-development)
  - [Installation](#installation)
    - [Prerequisites](#prerequisites)
    - [Install Lerna](#install-lerna)
    - [Install Local Dependencies](#install-local-dependencies)
  - [Running the Cumulus APIs Locally](#running-the-cumulus-apis-locally)
  - [Tests](#-tests)
    - [Unit Tests](#unit-tests)
            -[LocalStack](#localstack)
    - [Integration Tests](#integration-tests)
    - [Running Tests via VS Code Debugger](#running-tests-via-vs-code-debugger)
  - [Code Coverage And Quality](#-code-coverage-and-quality)
  - [Adding New Packages](#-adding-new-packages)
  - [Cleaning Up All The Repos](#cleaning-up-all-the-repos)
  - [Contribution](#contribution)
  - [Release](#-release)
- [More Information](#more-information)

---

## 📖 Documentation

- Documentation for the latest [released version](https://nasa.github.io/cumulus).
- Documentation for the [unreleased work](https://nasa.github.io/cumulus/docs/next/).
- Documentation: [How To's](./docs/docs-how-to.md) when serving and updating the documentation.

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

This is for installation for Cumulus development. See the [Cumulus deployment section](https://nasa.github.io/cumulus/docs/deployment) for instructions on deploying the released Cumulus packages.

### Prerequisites

- [NVM](https://github.com/creationix/nvm) and node version 16.19.0
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

```sh
npm install -g lerna
```

### Install Local Dependencies

We use npm for local package management. Run the following to get your dependencies set up.

```sh
npm install
npm run bootstrap
```

Build all packages:

```sh
npm run build
```

Build and watch packages:

```sh
npm run watch
```

To add new packages go to [Adding New Packages](#-adding-new-packages) for guidance.

## Running the Cumulus APIs locally

Start the API:

```sh
npm run serve
```

Or start the distribution API:

```sh
npm run serve-dist
```

See the [API package documentation](packages/api/README.md#running-the-api-locally) for more options.

## 📝 Tests

### Unit Tests

#### LocalStack

[LocalStack](https://github.com/localstack/localstack) provides local versions of most AWS services for testing.

The LocalStack repository has [installation instructions](https://github.com/localstack/localstack#installing).

Localstack is included in the docker-compose file. You only need to run the docker-compose command in the next section in order to use it with your tests.

#### Docker containers

Turn on the docker containers first:

```sh
npm run start-unit-test-stack
```

Stop localstack/unit test services:

```sh
npm run stop-unit-test-stack
```

#### Run database migrations

```sh
npm run db:local:migrate
```

#### Using an AWS-hosted Elasticsearch server

The tests can be run against an Elasticsearch server running in AWS. This is useful if you are using an ARM-equipped Mac and are unable to run the old Intel version of Elasticsearch in Docker. These instructions assume that you have a deployment of Cumulus available, and the deployment name is "EXAMPLE".

##### Pre-Reqs

- The [AWS CLI](https://aws.amazon.com/cli/) is installed
- The [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) for the AWS CLI is installed
- [jq](https://stedolan.github.io/jq/) is installed
- Your Cumulus deployment specified a `key_name` in `cumulus-tf/terraform.tfvars` that will grant you access to the EC2 instances that are part of that deployment
- You are able to SSH into one of your EC2 instances (you are connected to a NASA VPN if required)

##### Configure ssh

Add the following to your `~/.ssh/config` file

```text
Host i-*
  User ec2-user
  ProxyCommand sh -c "aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters 'portNumber=%p'"
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
```

##### Start the ssh tunnel to Elasticsearch

Open an SSH tunnel to Elasticsearch with the following command.

```sh
./bin/es-tunnel.sh EXAMPLE
```

At this point you can send requests to <https://localhost:8443> and get responses from your Elasticsearch domain running in AWS. Note that, because you're tunneling TLS-encrypted traffic, the certificates are not going to match. The test code handles this already but, if you're using `curl`, make sure to use the `-k` option to disable strict certificate checks.

```sh
$ curl -k https://localhost:8443
{
  "name" : "ABC123",
  "cluster_name" : "123:abc-es-vpc",
  "cluster_uuid" : "abc-Ti6N3IA2ULvpBQ",
  "version" : {
    "number" : "5.3.2",
    "build_hash" : "6bc5aba",
    "build_date" : "2022-09-02T09:03:07.611Z",
    "build_snapshot" : false,
    "lucene_version" : "6.4.2"
  },
  "tagline" : "You Know, for Search"
}
```

##### Run the tests

With the tunnel configured, you can now run the tests with the following command:

```sh
env \
  LOCAL_ES_HOST_PORT=8443 \
  LOCAL_ES_HOST_PROTOCOL=https \
  LOCAL_ES_HOST=localhost \
  LOCALSTACK_HOST=127.0.0.1 \
npm test
```

#### Run tests

Run the test commands next

```sh
export LOCAL_ES_HOST=127.0.0.1
export LOCALSTACK_HOST=127.0.0.1
npm test
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

```sh
lerna exec -- rm -rf ./package-lock.json
```

## Cleaning Up all the repos

```sh
npm run clean
```

---

## Contribution

Please refer to: https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md for more information.

## 🛒 Release

To release a new version of cumulus [read this](docs/development/release.md).

---

## More Information

For more information about this project or more about NASA's Earth Observing System Data and Information System (EOSDIS) and its cloud work, please contact [Katie Baynes](mailto:katie.baynes@nasa.gov) or visit us at https://earthdata.nasa.gov.
