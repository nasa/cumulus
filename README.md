# Cumulus Framework

## Installing and deploying

### Prerequisites

* node.js >= 4.3 (https://nodejs.org/en/). We recommend using nvm (https://github.com/creationix/nvm)
* AWS CLI (http://docs.aws.amazon.com/cli/latest/userguide/installing.html)
* Ruby
* BASH
* Docker (only required for building new container images)

Install the correct node version:

```
nvm install 4.3
```

Ensure that the aws cli is configured and that the default output format is either JSON or None:

```
aws configure
```

### Install Lerna

We use Lerna to manage multiple Cumulus packages in the same repo. You need to install lerna as a global module first:

    $ npm install -g lerna

### Install Local Dependencies

We use Yarn for local package management

    $ npm install
    $ npm run bootstrap

Building All packages:

    $ npm run build

Build and watch packages:

    $ npm run watch

## Running Tests

Turn on the docker containers first:

    $ docker-compose up local

Run the test commands next

    $ npm run test

## Adding New Packages

Create a new folder under `packages` if it is a common library or create folder under `cumulus/tasks` if it is a lambda task. `cd` to the folder and run `npm init`.

Make sure to name the package as `@cumulus/package-name`.

## Publishing to NPM

    $ lerna publish

## Running command in all package folders

    $ lerna exec -- rm -rf ./package-lock.json

## Cleaning Up all the repos

    $ npm run clean

