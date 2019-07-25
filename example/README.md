#  Cumulus Deployment Example

We use this deployment example for running the Cumulus integration tests. This example is tested with the latest release of the Cumulus project.

## Installation

```bash
nvm use
npm install
```

## Running tests locally

These tests run against AWS, so a Cumulus deployment is needed. Set up the deployment using the configurations in this repository. Deployment instructions are located [here](https://nasa.github.io/cumulus/docs/deployment/deployment-readme). The dashboard is not needed for these tests.

### How to configure your test stack

Your default AWS credentials should be the same credentials used for the deployment.

You should deploy your own stack on AWS and use that for testing. To configure and deploy your stack, add a new deployment to `app/config.yml` and `iam/config.yml` files and deploy them. You will also need to copy `app/.env.sample` to `app/.env` and provide your configuration.

Use the name of your deployment to run the tests by setting the `DEPLOYMENT` environment variable. For example:

```
DEPLOYMENT=cumulus-from-source jasmine spec/ingestGranule/IngestGranuleSuccessSpec.js
```

NOTE: For this to work you need your default credentials to be credentials for the `cumulus-sndbx` AWS account.

### Deploying the distribution API

The distribution API uses the [Thin Egress App](https://github.com/asfadmin/thin-egress-app), and is deployed
using [Terraform](https://terraform.io).

#### Install Terraform

If you are using a Mac and [Homebrew](https://brew.sh), installing Terraform is
as simple as:

```shell
$ brew update
$ brew install terraform
```

For other cases,
[installation instructions](https://learn.hashicorp.com/terraform/getting-started/install.html)
are available.

Verify that the version of Terraform installed is at least v0.12.0.

```shell
$ terraform --version
Terraform v0.12.2
```

#### Configure the Terraform backend

The state of the Terraform deployment is stored in S3. In the following
examples, it will be assumed that state is being stored in a bucket called
`my-tf-state`. You can also use an existing bucket, if desired.

Create the state bucket:

```shell
$ aws s3api create-bucket --bucket my-tf-state
```

In order to help prevent loss of state information, it is recommended that
versioning be enabled on the state bucket:

```shell
$ aws s3api put-bucket-versioning \
    --bucket my-tf-state \
    --versioning-configuration Status=Enabled
```

Terraform uses a lock stored in DynamoDB in order to prevent multiple
simultaneous updates. In the following examples, that table will be called
`my-tf-locks`.

Create the locks table:

⚠️ **Note:** The `--billing-mode` option was recently added to the AWS CLI. You
may need to upgrade your version of the AWS CLI if you get an error about
provisioned throughput when creating the table.

```shell
$ aws dynamodb create-table \
    --table-name my-tf-locks \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST
```

In the `example` directory, create the `terraform.tf` file, substituting the
appropriate values for `bucket` and `dynamodb_table`:

**terraform.tf**
```hcl
terraform {
  backend "s3" {
    region         = "us-east-1"
    bucket         = "my-tf-state"
    key            = "terraform.tfstate"
    dynamodb_table = "my-tf-locks"
  }
}
```

#### Configure the Cumulus deployment

In the `example` directory, copy `terraform.tfvars.example` to
`terraform.tfvars` and update all of the parameters using values appropriate for
your deployment:

#### Deploy Cumulus

```shell
$ terraform init
$ terraform apply

...

Apply complete! Resources: 2 added, 0 changed, 0 destroyed.

Outputs:

s3_credentials_redirect_uri = https://abc123.execute-api.us-east-1.amazonaws.com/DEV/redirect
distribution_url = https://abc123.execute-api.us-east-1.amazonaws.com/DEV/
thin_egress_app_redirect_uri = https://abc123.execute-api.us-east-1.amazonaws.com/DEV/login
```

Copy the output value of `distribution_url` and add it as the value of
`distribution_url` in `terraform.tfvars`, adding your configured tunneling port.

Re-deploy Cumulus:

```shell
$ terraform apply

...

Apply complete! Resources: 2 added, 0 changed, 0 destroyed.

Outputs:

s3_credentials_redirect_uri = https://abc123.execute-api.us-east-1.amazonaws.com:7000/DEV/redirect
distribution_url = https://abc123.execute-api.us-east-1.amazonaws.com:7000/DEV/
thin_egress_app_redirect_uri = https://abc123.execute-api.us-east-1.amazonaws.com:7000/DEV/login
```

Copy the value of `s3_credentials_redirect_uri` and
`thin_egress_app_redirect_uri` and add them to the list of Redirect URIs
configured for your app in URS.

As documented
[here](https://wiki.earthdata.nasa.gov/display/CUMULUS/Using+Cumulus+with+Private+APIs),
update your `/etc/hosts` and `~/.ssh/config` files with the new distribution
hostname.

Login to the VPN, start up an ssh tunnel through the bastion host, and then
browse to
https://abc123.execute-api.us-east-1.amazonaws.com:7000/DEV/my-protected/path/to/some/object

### Additional deployment steps

An S3 Access lambda is needed in the us-west-2 region to run the integration tests. To initially create the lambda, run:

```
aws lambda create-function --region us-west-2  --function-name <STACK>-S3AccessTest --zip-file fileb://app/build/cloudformation/<ZIP>-S3AccessTest.zip  --role arn:aws:iam::<AWS_ACCOUNT_ID>:role/<PREFIX>-lambda-processing  --handler index.handler --runtime nodejs8.10 --profile <NGAP Profile>
```

Replace `<AWS_ACCOUNT_ID>` with your account Id, `<STACK>` with your stack name, `<PREFIX>` with your iam prefix name, and use your NGAP profile. An S3AccessTest zip file `<ZIP>` can be found under `app/build/` following a stack deployment (either in `cloudformation` or `workflow_lambda_versions` depending on your stack configuration). The version of the zip file that you upload does not matter, but you need to deploy something to us-west-2 so that travis can update it with current lambdas.

If you need, after the initial creation of this lambda, you can update it by running:

```
./node_modules/.bin/kes lambda S3AccessTest deploy --kes-folder app --template node_modules/@cumulus/deployment/app --deployment <deployment> --region us-west-2 --profile < NGAP Profile >
```

This command will update the lambda with the latest lambda code.

### Access to test data

Test data comes from the @cumulus/test-data package and is uploaded to S3 during the setup step when running all tests. The data will be uploaded to the S3 bucket specified in the test configuration.

### Fake data server

A fake server is required for tests testing FTP/HTTP/HTTPS discover and downloads. The fake server should be set up once per account.

The Cloudformation template for the fake data server is in `fake-server.yml`. To setup the fake server run:

```
aws cloudformation deploy --template-file fake-server.yml --stack-name <stack-name> --parameter-overrides VpcId=<vpc-XXXXX> SubnetId=<subnet-XXXXXX> AZone=<az-zone> Ngap=true --capabilities CAPABILITY_NAMED_IAM
```

with the following parameters
* stack-name - stack name for the fake server
* VpcId - vpc id
* SubnetId - subent id
* AZone - availability zone, needs to match the subnet id's availability zone
* Ngap - true if in an NASA NGAP environment, will add the NGAP permission boundary to the IAM role created

In the outputs section of your Cloudformation deployment in the AWS console, you can find the address of the fake server created. In the provider configurations in `example/data/providers`, update the providers to use the correct host address.

By default, the data location is the `cumulus-data-shared` S3 bucket. To use a different bucket for test data, update `fake-server.yml` with the alternative bucket.

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

To use your own CF stack for running integration tests in bamboo, add
your stack name [here](../bamboo/select-stack.js).

## Additional Notes

### Redeployment During Tests

There are tests for redeploying the Cumulus stack while a workflow is running (see `spec/standalone/redeployment`). This is acheived by backing up with the `workflows.yml` file, updating it, and redeploying the stack. When redeploy tests are complete, the original `workflows.yml` is restored, the backup file is deleted, and the stack is redeployed, restoring it to its original state.

Please note that the stack will be redeployed multiple times when running tests and any errors during redeployment can result in errors in later tests. The deployment output is printed to the console.

### S3 Access Tests

The direct S3 access tests (`s3AccessSpec`) are specific to NASA NGAP accounts. You will need the NGAP in-region access policy applied to all of your public and protected buckets for these tests to work.

# Troubleshooting

## Distribution API tests

If you are experiencing failures in `spec/parallel/testAPI/distributionSpec.js`:

- Make sure you have set `EARTHDATA_CLIENT_ID` and `EARTHDATA_CLIENT_PASSWORD` environment variables
- Make sure you have added `http://localhost:5002/redirect` as a valid redirect URI for the Earthdata app corresponding to the `EARTHDATA_CLIENT_ID` environment variable
- Make sure you have set `EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD` environment variables
  - Make sure that these credentials are valid for login to the Earthdata app corresponding to the `EARTHDATA_CLIENT_ID` environment variable
  - If you are sure that the credentials are correct, but they are still not working, it may be because that username has not authorized the Earthdata app identified by the `EARTHDATA_CLIENT_ID` environment variable. Authorizing an Earthdata login app for a user account requires logging in once via the web. Use the following URL to log in to your Earthdata app, replacing `EARTHDATA_CLIENT_ID` with your client ID:

    `https://uat.urs.earthdata.nasa.gov/oauth/authorize?client_id=EARTHDATA_CLIENT_ID&redirect_uri=http%3A%2F%2Flocalhost%3A5002%2Fredirect&response_type=code`
