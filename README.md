# Cumulus Framework

[![CircleCI](https://circleci.com/gh/cumulus-nasa/cumulus.svg?style=svg&circle-token=4a16cbbdacb6396c709309ef5ac87479c9dc8bd1)](https://circleci.com/gh/cumulus-nasa/cumulus)

## Installing and deploying

### Prerequisites

* node.js >= 4.3 (https://nodejs.org/en/). We recommend using nvm (https://github.com/creationix/nvm) and node version 7.6.
* [pip](https://pip.pypa.io/en/stable/installing/)
* [yarn](https://yarnpkg.com/en/)
* [AWS CLI](http://docs.aws.amazon.com/cli/latest/userguide/installing.html)
* Ruby
* BASH
* Docker (only required for building new container images)
* docker-compose (`pip install docker-compose`)

Install the correct node version:

```
nvm install
nvm use
```

Ensure that the aws cli is configured and that the default output format is either JSON or None:

```
aws configure
```

### Install Lerna

We use Lerna to manage multiple Cumulus packages in the same repo. You need to install lerna as a global module first:

    $ yarn global add lerna

### Install Local Dependencies

We use yarn for local package management

    $ yarn install
    $ yarn ybootstrap

Building All packages:

    $ yarn build

Build and watch packages:

    $ yarn watch

## Running Tests

Turn on the docker containers first:

    $ docker-compose up local

If you prefer to run docker in detached mode (i.e. run containers in the background), run:

    $ docker-compose up -d local

Run the test commands next

    $ yarn test

## Adding New Packages

Create a new folder under `packages` if it is a common library or create folder under `cumulus/tasks` if it is a lambda task. `cd` to the folder and run `npm init`.

Make sure to name the package as `@cumulus/package-name`.

## Publishing to NPM

    $ lerna publish

## Running command in all package folders

    $ lerna exec -- rm -rf ./package-lock.json

## Cleaning Up all the repos

    $ npm run clean

