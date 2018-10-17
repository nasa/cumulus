#  Cumulus Deployment Example

We use this deployment example for running the Cumulus integration tests. This example is tested with the latest release of the Cumulus project.

## Installation

```bash
nvm use
yarn
```

## Running tests locally

These tests run against AWS, so a Cumulus deployment is needed. Set up the deployment using the configurations in this repository. Deployment instructions are located [here](https://nasa.github.io/cumulus/deployment/). The dashboard is not needed for these tests.

### How to configure your test stack

Your default AWS credentials should be the same credentials used for the deployment.

You should deploy your own stack on AWS and use that for testing. To configure and deploy your stack, add a new deployment to `app/config.yml` and `iam/config.yml` files and deploy them. You will also need to copy `app/.env.sample` to `app/.env` and provide your configuration.

Use the name of your deployment to run the tests by setting the `DEPLOYMENT` environment variable. For example:

```
DEPLOYMENT=cumulus-from-source jasmine spec/ingestGranule/IngestGranuleSuccessSpec.js
```

NOTE: For this to work you need your default credentials to be credentials for the `cumulus-sndbx` AWS account.

### Additional deployment steps

An S3 Access lambda is needed in the us-west-1 region to run the tests. To initially create the lambda, run:

```
aws lambda create-function --region us-west-1  --function-name <STACK>-S3AccessTest --zip-file fileb://app/build/cloudformation/<ZIP>-S3AccessTest.zip  --role arn:aws:iam::<AWS_ACCOUNT_ID>:role/<PREFIX>-lambda-processing  --handler index.handler --runtime nodejs6.10 --profile ngap-sandbox
```

Replace `<AWS_ACCOUNT_ID>` with your account Id, `<STACK>` with your stack name, `<PREFIX>` with your iam prefix name, and the zip file `<ZIP>` can be found in `app/build/cloudformation/` following a deployment. The zip file does not matter, but you need something there.

After the initial creation of this lambda, you can update it by running:

```
./node_modules/.bin/kes lambda S3AccessTest deploy --kes-folder app --template node_modules/@cumulus/deployment/app --deployment <deployment> --region us-west-1
```

This command will update the lambda with the latest lambda code.

### Access to test data

Test data comes from the @cumulus/test-data package and is uploaded to S3 during the setup step when running all tests. The data will be uploaded to the S3 bucket specified in the test configuration.

### Run all tests

Tests are written and run with [jasmine](https://jasmine.github.io/setup/nodejs.html).

To run all of the tests, run `DEPLOYMENT=<name-of-your-deployment> npm test` in this directory.

### Run tests for an individual test file

To run an individual test file, include a path to the spec file, i.e. `DEPLOYMENT=<name-of-your-deployment> npm test spec/helloWorld/HelloWorldSuccessSpec.js`.

## Adding tests

### Adding tests for an existing workflow

Workflow tests are located in the `/spec/<workflow-name>` folder. Any tests and supporting JSON files can go in there.

### Adding a new test workflow

The workflow should be configured as it would be for a normal Cumulus deployment in a workflows yaml file. It must be deployed to the current deployment if testing locally.

The workflows yaml files are located in the `/workflows/` folder and are split up to make the workflows easier to find and understand. When adding a new file, make sure to update the `app/config.yml` `stepFunctions` field.

A new folder should be added in the `/spec` folder for the workflow and the tests should go into that folder with the input JSON files.

## Using your AWS CF stack in Travis CI

To use your own CF stack for running integration tests in Travis CI builds, add
your stack name [here](../travis-ci/select-stack.js).

## Additional Notes

### Redeployment During Tests

There are tests for redeploying the Cumulus stack while a workflow is running (see `spec/redeployment`). This is acheived by backing up with the `workflows.yml` file, updating it, and redeploying the stack. When redeploy tests are complete, the original `workflows.yml` is restored, the backup file is deleted, and the stack is redeployed, restoring it to its original state.

Please note that the stack will be redeployed multiple times when running tests and any errors during redeployment can result in errors in later tests. The deployment output is printed to the console.

## Cumulus Documentation

Our project documentation is hosted on [GitHub Pages](https://pages.github.com/). The resources published to this website are housed in `docs/` directory at the top of the Cumulus repository. Those resources primarily consist of markdown files and images.

We use the open-source static website generator [Docusaurus](https://docusaurus.io/) to build html files from our markdown documentation, add some organization and navigation, and provide some other niceties in the final website (search, easy templating, etc.).

### Deploying Docs Locally

There have been scripts set up for local deployment and this should be relatively simple.

1. Pull Cumulus repository and navigate to the top level.
2. run `(cd website && yarn install)` to acquire dependencies required for building and serving docs.
3. run `yarn docs-start` to start a local server that you can navigate through and test against.

**Note:** `docs-build` will build the documents into `website/build/Cumulus`.

### Adding Docs

This should be as simple as writing some documentation in markdown, placing it under the correct directory in the `docs/` folder and adding some configuration values wrapped by `---` at the top of the file. There are many files that already have this header which can be used as reference.
```
---
id: doc-unique-id    # unique id for this document. This must be unique accross ALL documents.
title: Title Of Doc  # Whatever title you feel like adding. This will show up as the index to this page on the sidebar.
hide_title: true     # So the title of the Doc doesn't show up at the top of the webpage (generally we already have the title written as h1 in the documentation).
---
```

### Versioning Docs

We lean heavily on Docusaurus for documentation versioning. They're suggestions and walkthrough can be found [here](https://docusaurus.io/docs/en/versioning). It is worth noting that we would like the Documentation versions to match up directly with release versions.
