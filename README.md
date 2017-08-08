# Cumulus Framework

## Installing and deploying

### Install Lerna

We use Lerna to manage multiple Cumulus packages in the same repo. You need to install lerna as a global module first:

    $ npm install -g lerna

### Install Local Dependencies

We use Yarn for local package management

    $ yarn install
    $ lerna bootstrap

## Running Tests

Turn on the docker containers first:

    $ docker-compose up local

Run the test commands next

    $ lerna run test


### AWS

Ensure that the aws cli is configured and that the default output format is either JSON or None:

```
aws configure
```

## Adding New Packages

Create a new folder under `packages` if it is a common library or create folder under `cumulus/tasks` if it is a lambda task. `cd` to the folder and run `npm init`.

Make sure to name the package as `@cumulus/package-name`.

## Publishing to NPM

    $ lerna publish

## Running command in all package folders

    $ lerna exec -- rm -rf ./package-lock.json

## Cleaning Up all the repos

    $ lerna clean

