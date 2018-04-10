#  Cumulus Integration Test Project

[![CircleCI](https://circleci.com/gh/cumulus-nasa/cumulus-integration-tests.svg?style=svg)](https://circleci.com/gh/cumulus-nasa/cumulus-integration-tests)

## What is Cumulus?

Cumulus is a cloud-based data ingest, archive, distribution and management
prototype for NASA's future Earth science data streams.

Read the [Cumulus Documentation](https://cumulus-nasa.github.io/)

## Installation

```bash
nvm use
npm install
```

## Running tests locally

These tests run against AWS, so a Cumulus deployment is needed. Set up the deployment using the configurations in this repository. Deployment instructions are located [here](https://cumulus-nasa.github.io/docs/deployment.html). The dashboard is not needed for these tests.

### How to configure your test stack

Your default AWS credentials should be the same credentials used for the deployment.

To use a different stack name, update `app/config.yml`, `iam/config.yml` and `deployer/config.yml`.

When tests run, by default tests will use the configuration defined in `spec/config.yml` to try and execute a workflow. These variables are required for tests to run on CircleCI.

Configuration can be overriden in your own `spec/config.override.yml`. If you are getting setup for the first time:

```
cp spec/config.yml spec/config.override.yml
```

And then edit `spec/config.override.yml`.

Using an override file is required if using a stack other than the `test-cumulus` stack in the `cumulus-sndbx` AWS account. If you want to switch back to the default `spec/config.yml` file, you can specify `USE_DEFAULT_CONFIG=true` when running tests. E.g.:

```
USE_DEFAULT_CONFIG=true AWS_ACCOUNT_ID=<cumulus-sndbx-account-id> jasmine spec/ingestGranule/IngestGranuleSuccessSpec.js
```

NOTE: For this to work you need your default credentials to be credentials for the `cumulus-sndbx` AWS account.

### Additional deployment steps

An S3 Access lambda is needed in the us-west-1 region to run the tests. To initially create the lambda, run:

```
aws lambda create-function --region us-west-1  --function-name <STACK>-integration-S3AccessTest --zip-file fileb://app/build/cloudformation/<ZIP>-S3AccessTest.zip  --role arn:aws:iam::<AWS_ACCOUNT_ID>:role/<STACK>-integration-lambda-processing  --handler index.handler --runtime nodejs6.10 --profile ngap-sandbox
```

Replace <AWS_ACCOUNT_ID> with your accound Id, <STACK> with your stack name, and the zip file <ZIP> can be found in app/build/cloudformation/ following a deployment. The zip file does not matter, but you need something there. 

After the initial creation of this lambda, you can update it by running:

```
kes lambda S3AccessTest deploy --kes-folder app --template node_modules/@cumulus/deployment/app --deployment <deployment> --region us-west-1
```

This command will update the lambda with the latest lambda code.

### Access to test data

To access test data in `s3://cumulus-data-shared`, which is required by all specs except helloWorld, the lambda processing role for your deployment must have access to this bucket. This can be done by redeploying your IAM stack using the cloudformation template in the `iam/` directory. This IAM deployment creates a reference to `SharedBucketName` as `cumulus-data-shared` and adds `cumulus-data-shared` as part of the access policy for `LambdaProcessingRole`.

### Run all tests

Tests are written and run with [jasmine](https://jasmine.github.io/setup/nodejs.html).

To run all of the tests, run `npm test` in the top level of the repository.

When running tests locally, include the `AWS_ACCOUNT_ID` of your deployment.

Your AWS Account ID is a 12-digit number that is a part of any ARN (Amazon Resource Name) for your AWS account. It can also be discovered on your AWS [My Account](https://console.aws.amazon.com/billing/home?#/account) page.

```bash
AWS_ACCOUNT_ID=000000000000 npm test
```

### Run tests for an individual test file

To run an individual test file, include a path to the spec file, i.e. `npm test spec/helloWorld/HelloWorldSuccessSpec.js`.

## Adding tests

### Adding tests for an existing workflow

Workflow tests are located in the `/spec/<workflow-name>` folder. Any tests and supporting JSON files can go in there. 

### Adding a new test workflow

The workflow should be configured as it would be for a normal Cumulus deployment in `workflows.yml`. It must be deployed to the current deployment if testing locally.

A new folder should be added in the `/spec` folder for the workflow and the tests should go into that folder with the input JSON files. 

# CircleCI
This is how our integration tests on circleci install and use cumulus packages:
- If a package exists on npm, the source code of the packages is installed from npm
- if a package does not exists on npm yet, circleci installs it from the Cumulus repo
- by default the packages are installed from the `master` branch of the Cumulus repo
- You can specify the branch of the cumulus repo by:
  - setting `CUMULUS_BRANCH` environment variable on circleci
  - adding the `.cumulus_branch` file on the root of the integration repo and specifying the branch name
  - `CUMULUS_BRANCH` takes precedent over `.cumulus_branch` file name

## Using latest Cumulus Source code for local tests
By default, the integration tests use latests Cumulus packages published to the NPM. To use the packages from the Cumulus repository, do the following:
- Make sure cumulus repo is cloned relative to the integration repo. We assume the cumulus repo is cloned to `../cumulus`
- Install all the dependencies in the cumulus repo by running `yarn` and `yarn bootstrap-no-build` in the cumulus folder
- Run `./bin/prepare` command in this folder
- deploy aws by running the kes command (as explained above)
- run the tests

## How to make changes to the cumulus repo that require changes to the cumulus-integration-tests repo
- Create a branch on the `cumulus` repo
- Make and commit your changes in the branch on the `cumulus` repo
- Push the branch to the `cumulus` repo
- Create a new branch from `master` in the `cumulus-integration-tests` repo
- Update `.cumulus_branch` and point it at your branch on the `cumulus` repo
- Update the package version in `package.json` to the version of the next release (if you don't know what the next version is going to be contact the Cumulus scrum master)
- To test locally, run `./bin/prepare`, deploy to AWS, and follow the [Run all tests] section in this README
- To test on CircleCI, push your changes to github and check CircleCI

## Forcing CircleCI to use packages from cumulus core
CircleCI will uses packages from NPM to run the integration tests. If you want to force the CI to use packages from the cumulus repo, do the following:
- Update @cumulus packages version to in `package.json` to a version not released yet
- If you need to get the source code from a branch of Cumulus other than master, set environment variable `CUMULUS_BRANCH`

