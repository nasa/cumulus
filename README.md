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

    $ lerna run test

## Development

Make sure to use webpack to compile all the packages. Each compiled package is stored under `packages/package-name/dist/index.js`.

## Adding New Packages

Create a new folder under `packages`. `cd` to the folder and run `npm init`.

Make sure to name the package as `@cumulus/package-name`.

## Publishing to NPM

    $ lerna publish

## Running command in all package folders

    $ lerna exec -- rm -rf ./package-lock.json

## Cleaning Up all the repos

    $ lerna clean

