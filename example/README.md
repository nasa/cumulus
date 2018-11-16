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

Tests are separated into standalone and parallel folders. The `standalone` folder is for tests that cannot be run in parallel with any other tests and should be run in a separate job, for example, the redeployment tests that are only run by Travis on master.

The `parallel` folder holds tests that can be run in parallel.

All other tests in the spec folder will be run in serial.

To run all tests outside of standalone, run `DEPLOYMENT=<name-of-your-deployment> npm test` in this directory. The parallel tests will be run in parallel locally and on CI.

To run all of the tests, including standalone, run `DEPLOYMENT=<name-of-your-deployment> npm run all-tests` in this directory.

### Run tests for an individual test file

To run an individual test file, include a path to the spec file, i.e. `DEPLOYMENT=<name-of-your-deployment> node_modules/.bin/jasmine spec/helloWorld/HelloWorldSuccessSpec.js`.

Jasmine supports wildcard expressions for running tests, so an entire test folder can be run using `DEPLOYMENT=<name-of-your-deployment> node_modules/.bin/jasmine spec/standalone/*`

## Adding tests

### Adding tests for an existing workflow

Workflow tests are located in the `/spec/<workflow-name>` folder. Any tests and supporting JSON files can go in there.

### Adding a new test workflow

The workflow should be configured as it would be for a normal Cumulus deployment in a workflows yaml file. It must be deployed to the current deployment if testing locally.

The workflows yaml files are located in the `/workflows/` folder and are split up to make the workflows easier to find and understand. When adding a new file, make sure to update the `app/config.yml` `stepFunctions` field.

A new folder should be added in the `/spec` folder for the workflow and the tests should go into that folder with the input JSON files.

Ideally the test can run in parallel with other tests and should be put in the `parallel` folder. If it cannot be, it should go in the `spec` folder. Only if the test should be run outside of the test suite should it go in the `standalone` folder.

## Using your AWS CF stack in Travis CI

To use your own CF stack for running integration tests in Travis CI builds, add
your stack name [here](../travis-ci/select-stack.js).

## Additional Notes

### Redeployment During Tests

There are tests for redeploying the Cumulus stack while a workflow is running (see `spec/standalone/redeployment`). This is acheived by backing up with the `workflows.yml` file, updating it, and redeploying the stack. When redeploy tests are complete, the original `workflows.yml` is restored, the backup file is deleted, and the stack is redeployed, restoring it to its original state.

Please note that the stack will be redeployed multiple times when running tests and any errors during redeployment can result in errors in later tests. The deployment output is printed to the console.

