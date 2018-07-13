#  Cumulus Deployment Example 

We use this deployment example for running the Cumulus integration tests. This example is tested with the latest release of the Cumulus project.

## Installation

```bash
nvm use
yarn
```

## Running tests locally

These tests run against AWS, so a Cumulus deployment is needed. Set up the deployment using the configurations in this repository. Deployment instructions are located [here](https://cumulus-nasa.github.io/deployment/). The dashboard is not needed for these tests.

### How to configure your test stack

Your default AWS credentials should be the same credentials used for the deployment.

You should deploy your own stack on AWS and use that for testing. To configure and deploy your stack, add a new deployment to `app/config.yml` and `iam/config.yml` files and deploy them.

Use the name of your deployment to run the tests by setting the `DEPLOYMENT` environment variable. For example:

```
DEPLOYMENT=cumulus-from-source jasmine spec/ingestGranule/IngestGranuleSuccessSpec.js
```

NOTE: For this to work you need your default credentials to be credentials for the `cumulus-sndbx` AWS account.

### Additional deployment steps

An S3 Access lambda is needed in the us-west-1 region to run the tests. To initially create the lambda, run:

```
aws lambda create-function --region us-west-1  --function-name <STACK>-S3AccessTest --zip-file fileb://app/build/cloudformation/<ZIP>-S3AccessTest.zip  --role arn:aws:iam::<AWS_ACCOUNT_ID>:role/<STACK>-lambda-processing  --handler index.handler --runtime nodejs6.10 --profile ngap-sandbox
```

Replace <AWS_ACCOUNT_ID> with your accound Id, <STACK> with your stack name, and the zip file <ZIP> can be found in app/build/cloudformation/ following a deployment. The zip file does not matter, but you need something there. 

After the initial creation of this lambda, you can update it by running:

```
./node_modules/.bin/kes lambda S3AccessTest deploy --kes-folder app --template node_modules/@cumulus/deployment/app --deployment <deployment> --region us-west-1
```

This command will update the lambda with the latest lambda code.

### Access to test data

Test data comes from the @cumulus/test-data package and is uploaded to S3 during the setup step when running all tests. The data will be uploaded to the S3 bucket specified in the test configuration.

### Run all tests

Tests are written and run with [jasmine](https://jasmine.github.io/setup/nodejs.html).

To run all of the tests, run `DEPLOYMENT=<name-of-your-deployment> npm test` in the top level of the repository.

### Run tests for an individual test file

To run an individual test file, include a path to the spec file, i.e. `DEPLOYMENT=<name-of-your-deployment> npm test spec/helloWorld/HelloWorldSuccessSpec.js`.

## Adding tests

### Adding tests for an existing workflow

Workflow tests are located in the `/spec/<workflow-name>` folder. Any tests and supporting JSON files can go in there. 

### Adding a new test workflow

The workflow should be configured as it would be for a normal Cumulus deployment in `workflows.yml`. It must be deployed to the current deployment if testing locally.

A new folder should be added in the `/spec` folder for the workflow and the tests should go into that folder with the input JSON files. 

## Using your AWS CF stack in CircleCI

To use your own CF stack for running integration tests in CircleCI builds, add your github username and your kes deployment name [here](spec/select#L5).

Example:

```bash
   developers=( ["myexample_github_username"]="mykesdeploymentname" )
```
