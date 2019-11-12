# Cumulus Deployment Example

We use this deployment example for running the Cumulus integration tests. This
example is tested with the latest release of the Cumulus project.

The Cumulus deployment is broken into two
[Terraform root modules](https://www.terraform.io/docs/configuration/modules.html),
`data-persistence-tf` and `cumulus-tf`. The `data-persistence-tf` module should
be deployed first, and creates the Elasticsearch domain and Dynamo tables. The
`cumulus-tf` module deploys the rest of Cumulus: distribution, API, ingest,
workflows, etc. The `cumulus-tf` module depends on the resources created in the
`data-persistence-tf` deployment.

The following instructions will walk you through installing Terraform,
configuring Terraform, deploying the two root modules, and running your tests.

## Install Terraform

If you are using a Mac and [Homebrew](https://brew.sh), installing Terraform is
as simple as:

```shell
brew update
brew install terraform
```

For other cases,
[installation instructions](https://learn.hashicorp.com/terraform/getting-started/install.html)
are available.

Verify that the version of Terraform installed is at least v0.12.0.

```shell
$ terraform --version
Terraform v0.12.2
```

**Note:** The version of terraform used in Bamboo is specified in the `example/.tfversion` file. It is recommended to use the same version locally to prevent inconsistencies and `upgrade to Terraform v<newer> or greater to work with this state` errors when working with deployments created or updated through Bamboo

## Clone and build Cumulus

Clone the `nasa/cumulus` repo from <https://github.com/nasa/cumulus.git>

In the top-level repo directory:

```bash
nvm use
npm install
npm run bootstrap
```

## Configure the Terraform backend

The state of the Terraform deployment is stored in S3. In the following
examples, it will be assumed that state is being stored in a bucket called
`my-tf-state`. You can also use an existing bucket, if desired.

Create the state bucket:

```shell
aws s3api create-bucket --bucket my-tf-state
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

## Configure and deploy the `data-persistence-tf` root module

These steps should be executed in the `example/data-persistence-tf` directory.

Create a `terraform.tf` file, substituting the appropriate values for `bucket`,
`dynamodb_table`, and `<stack>`. This tells Terraform where to store its
remote state.

**terraform.tf:**

```hcl
terraform {
  backend "s3" {
    region         = "us-east-1"
    bucket         = "PREFIX-state"
    key            = "PREFIX/data-persistence/terraform.tfstate"
    dynamodb_table = "PREFIX-tf-locks"
  }
}
```

Copy the `terraform.tfvars.example` file to `terraform.tfvars`, and fill in
appropriate values. For additional information about the variables, see the [variable definitions for the `data-persistence` module](../tf-modules/data-persistence/variables.tf).

Run `terraform init`.

Run `terraform apply`.

This will deploy your data persistence resources.

## Configure and deploy the `cumulus-tf` root module

These steps should be executed in the `example/cumulus-tf` directory.

Create a `terraform.tf` file, substituting the appropriate values for `bucket`,
`dynamodb_table`, and `<stack>`. This tells Terraform where to store its
remote state.

**terraform.tf:**

```hcl
terraform {
  backend "s3" {
    region         = "us-east-1"
    bucket         = "PREFIX-state"
    key            = "PREFIX/cumulus/terraform.tfstate"
    dynamodb_table = "PREFIX-tf-locks"
  }
}
```

Copy the `terraform.tfvars.example` file to `terraform.tfvars`, and fill in
appropriate values. For additional information about the variables, see the [variable definitions for the `cumulus` module](../tf-modules/cumulus/variables.tf).

**Note:** The `data_persistence_remote_state_config` section should contain the
remote state values that you configured in
`example/data-persistence-tf/terraform.tf`. These settings allow `cumulus-tf` to
determine the names of the resources created in `data-persistence-tf`.

Run `terraform init`.

Run `terraform apply`.

## Configure the tests

These steps should be performed in the `example` directory.

Copy `.env.sample` to `.env`, filling in approriate values for your deployment.

Set the `DEPLOYMENT` environment variable to match the `prefix` that you
configured in your `terraform.tfvars` files.

Run `npm test`.

## Run all tests

Tests are written and run with [jasmine](https://jasmine.github.io/setup/nodejs.html).

Tests are separated into standalone and parallel folders. The `standalone` folder is for tests that cannot be run in parallel with any other tests and should be run in a separate job, for example, the redeployment tests that are only run by Bamboo on master.

The `parallel` folder holds tests that can be run in parallel.

All other tests in the spec folder will be run in serial.

To run all tests outside of standalone, run `DEPLOYMENT=<name-of-your-deployment> npm test` in this directory. The parallel tests will be run in parallel locally and on CI.

To run all of the tests, including standalone, run `DEPLOYMENT=<name-of-your-deployment> npm run all-tests` in this directory.

### Run tests for an individual test file

To run an individual test file, include a path to the spec file, i.e. `DEPLOYMENT=<name-of-your-deployment> node_modules/.bin/jasmine spec/helloWorld/HelloWorldSuccessSpec.js`.

Jasmine supports wildcard expressions for running tests, so an entire test folder can be run using `DEPLOYMENT=<name-of-your-deployment> node_modules/.bin/jasmine spec/standalone/*`

### Running Tests on SIT

In the event that you are running the tests outside of the Cumulus sandbox environment you will need to follow the [directions](#fake-data-server) to update your fake data server providers. Alternatively, you can set the environment variable `PROVIDER_HOST` to point to the private IP address of your FakeProvider EC2 instance.

## Adding tests

### Adding tests for an existing workflow

Workflow tests are located in the `/spec/<workflow-name>` folder. Any tests and supporting JSON files can go in there.

### Adding a new test workflow

The workflow should be configured as it would be for a normal Cumulus deployment in a workflows yaml file. It must be deployed to the current deployment if testing locally.

The workflows yaml files are located in the `/workflows/` folder and are split up to make the workflows easier to find and understand. When adding a new file, make sure to update the `app/config.yml` `stepFunctions` field.

A new folder should be added in the `/spec` folder for the workflow and the tests should go into that folder with the input JSON files.

Ideally the test can run in parallel with other tests and should be put in the `parallel` folder. If it cannot be, it should go in the `spec` folder. Only if the test should be run outside of the test suite should it go in the `standalone` folder.

## Fake data server

A fake server is required for tests testing FTP/HTTP/HTTPS discover and downloads. The fake server should be set up once per account.

The Cloudformation template for the fake data server is in `fake-server.yml`. To setup the fake server run:

```bash
aws cloudformation deploy --template-file fake-server.yml --stack-name <stack-name> --parameter-overrides VpcId=<vpc-XXXXX> SubnetId=<subnet-XXXXXX> AZone=<az-zone> Ngap=true --capabilities CAPABILITY_NAMED_IAM
```

with the following parameters:

- stack-name - Stack name for the fake server
- VpcId - VPC ID
- SubnetId - Subnet ID
- AZone - Availability zone, needs to match the Subnet ID's availability zone
- Ngap - `true` if in an NASA NGAP environment, will add the NGAP permission boundary to the IAM role created

In the outputs section of your Cloudformation deployment in the AWS console, you can find the IP address of the fake server created. To use this fake server with the tests, update the provider configurations in `example/data/providers` to use this host address.

### Update data bucket

By default, the data location is the `cumulus-data-shared` S3 bucket. To use a different bucket for test data, update `fake-server.yml` with the alternative bucket and re-deploy the fake data server.
