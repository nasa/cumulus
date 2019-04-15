---
id: deployment-readme
title: How to Deploy Cumulus
hide_title: true
---

# How to Deploy Cumulus

## Overview

This is a guide for deploying a new instance of Cumulus.

The deployment documentation is current for the following component versions:

* [Cumulus](https://github.com/nasa/cumulus)
* [Deployment Template](https://github.com/nasa/template-deploy)
* [Cumulus Dashboard](https://github.com/nasa/cumulus-dashboard)

The process involves:

* Creating [AWS S3 Buckets](https://docs.aws.amazon.com/AmazonS3/latest/dev/UsingBucket.html).
* Using [Kes](http://devseed.com/kes/) to transform kes templates (`cloudformation.template.yml`) into [AWS CloudFormation](https://aws.amazon.com/cloudformation/getting-started/) stack templates (`cloudformation.yml`) that are then deployed to AWS.
* Before deploying the Cumulus software, a CloudFormation stack is deployed that creates necessary [IAM roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html) via the `iams` stack.
* The Cumulus software is configured and deployed via the `app` stack.

--------------

## Requirements

### Linux/MacOS software requirements

* git
* [node 8.10](https://nodejs.org/en/) (use [nvm](https://github.com/creationix/nvm) to upgrade/downgrade)
* [npm](https://www.npmjs.com/get-npm)
* sha1sum or md5sha1sum
* zip
* AWS CLI - [AWS command line interface](https://aws.amazon.com/cli/)
* python

### Credentials

* [CMR](https://earthdata.nasa.gov/about/science-system-description/eosdis-components/common-metadata-repository) username and password.  Can be excluded if you are not exporting metadata to CMR. More information about CMR configuration can be found [here](./config_descriptions#cmr).
* [EarthData Client login](https://earthdata.nasa.gov/about/science-system-description/eosdis-components/earthdata-login) username and password. User must have the ability to administer and/or create applications in URS.  It's recommended to obtain an account in the test environment (UAT).

### Needed Git Repositories

* [Cumulus](https://github.com/nasa/cumulus) (optional)
* [Cumulus Dashboard](https://github.com/nasa/cumulus-dashboard)
* [Deployment Template](https://github.com/nasa/cumulus-template-deploy)

## Installation

### Prepare DAAC deployment repository

_If you already are working with an existing `<daac>-deploy` repository that is configured appropriately for the version of Cumulus you intend to deploy or update, skip to [Prepare AWS configuration.](deployment-readme#prepare-aws-configuration)_

Clone template-deploy repo and name appropriately for your DAAC or organization

```bash
  $ git clone https://github.com/nasa/template-deploy <daac>-deploy
```

Enter repository root directory

```bash
  $ cd <daac>-deploy
```

Then run:

```bash
  $ nvm use
  $ npm install
```

If you do not have the correct version of node installed, replace `nvm use` with `nvm install $(cat .nvmrc)` in the above example.

**Note**: The `npm install` command will add the [kes](http://devseed.com/kes/) utility to the `<daac>-deploy`'s `node_modules` directory and will be utilized later for most of the AWS deployment commands.

#### Obtain Cumulus Packages

Cumulus packages are installed from NPM using the `npm install` step above. For information on obtaining additional Cumulus packages, see [Obtaining Cumulus Packages](deployment/obtain_cumulus_packages.md).

### Copy the sample template into your repository

The [`Cumulus`](https://github.com/nasa/cumulus) project contains default configuration values in the `app.example` folder, however these need to be customized for your Cumulus app.

Begin by copying the template directory to your project. You will modify it for your DAAC's specific needs later.

```bash
  $ cp -r ./node_modules/@cumulus/deployment/app.example ./app
```

**Optional:** [Create a new repository](https://help.github.com/articles/creating-a-new-repository/) `<daac>-deploy` so that you can track your DAAC's configuration changes:

```bash
  $ git remote set-url origin https://github.com/nasa/<daac>-deploy
  $ git push origin master
```

You can then [add/commit](https://help.github.com/articles/adding-a-file-to-a-repository-using-the-command-line/) changes as needed.

### Prepare AWS configuration

#### Set Access Keys

You need to make some AWS information available to your environment. If you don't already have the access key and secret access key of an AWS user with IAM Create-User permissions, you must [Create Access Keys](https://docs.aws.amazon.com/general/latest/gr/managing-aws-access-keys.html) for such a user with IAM Create-User permissions, then export the access keys:

```bash
  $ export AWS_ACCESS_KEY_ID=<AWS access key>
  $ export AWS_SECRET_ACCESS_KEY=<AWS secret key>
  $ export AWS_REGION=<region>
```

If you don't want to set environment variables, [access keys can be stored locally via the AWS CLI.](http://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html)

### Create S3 Buckets

See [creating s3 buckets](deployment/create_bucket.md) for more information on how to create a bucket.

The following s3 bucket should be created (replacing prefix with whatever you'd like, generally your organization/DAAC's name):

* `<prefix>-internal`

You can create additional s3 buckets based on the needs of your workflows.

These buckets do not need any non-default permissions to function with Cumulus, however your local security requirements may vary.

**Note**: s3 bucket object names are global and must be unique across all accounts/locations/etc.

--------------

## Configure and Deploy the IAM stack

### Configure deployment with `<daac>-deploy/iam/config.yml`

The `iam` configuration creates 7 [roles](http://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html) and an [instance profile](http://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2_instance-profiles.html) used internally by the Cumulus stack.

--------------

**Sample new deployment added to config.yml**:

Descriptions of the fields can be found in [IAM Configuration Descriptions](deployment/config_descriptions.md#iam-configuration).

```yaml
dev:                                # deployment name
  prefix: dev-cumulus               # prefixes CloudFormation-created IAM resources and permissions
  stackName: dev-cumulus-iams       # name of this IAM stack in CloudFormation (e.g. <prefix>-iams)
  useNgapPermissionBoundary: true   # for NASA NGAP accounts

  buckets:
    internal:
      name: dev-internal            # internal bucket name
      type: internal
    private:
      name: dev-private             # private bucket name
      type: private
    protected:
      name: dev-protected           # protected bucket name
      type: protected
    public:
      name: dev-cumulus-public      # public bucket name
      type: public
    otherpublic:                    # Can have more than one of each type of bucket
      name: dev-default
      type: public
```

**Deploy `iam` stack**[^1]

```bash
  $ DEPLOYMENT=<iam-deployment-name> \
      AWS_REGION=<region> \ # e.g. us-east-1
      AWS_PROFILE=<profile> \
      npm run deploy-iam
```

**Note**: If this deployment fails check the deployment details in the AWS Cloud Formation Console for information. Permissions may need to be updated by your AWS administrator.

If the `iam` deployment command  succeeds, you should see 7 new roles in the [IAM Console](https://console.aws.amazon.com/iam/home):

* `<prefix>-ecs`
* `<prefix>-lambda-api-gateway`
* `<prefix>-lambda-processing`
* `<prefix>-scaling-role`
* `<prefix>-steprole`
* `<prefix>-distribution-api-lambda`
* `<prefix>-migration-processing`

The same information can be obtained from the AWS CLI command: `aws iam list-roles`.

The `iam` deployment also creates an instance profile named `<stack-name>-ecs` that can be viewed from the AWS CLI command: `aws iam list-instance-profiles`.

--------------

## Configure and Deploy the Cumulus stack

These updates configure the [copied template](deployment-readme#copy-the-sample-template-into-your-repository) from the cumulus repository for your DAAC.

You should either add a new root-level key for your configuration or modify the existing default configuration key to whatever you'd like your new deployment to be.

If you're re-deploying based on an existing configuration you can skip this configuration step unless values have been updated *or* you'd like to add a new deployment to your deployment configuration file.

**Edit the  `<daac>-deploy/app/config.yml` file**

--------------

### Sample config.yml

Descriptions of the fields can be found in [App Configuration Descriptions](deployment/config_descriptions.md#app-configuration).

```yaml
dev:                            # deployment name
  stackName: dev-cumulus        # Required. See note below
  stackNameNoDash: DevCumulus   # Required.

  apiStage: dev                 # Optional

  vpc:                          # Required for NGAP environments
    vpcId: '{{VPC_ID}}'         # this has to be set in .env
    subnets:
      - '{{AWS_SUBNET}}'        # this has to be set in .env

  ecs:                          # Required
    instanceType: t2.micro
    desiredInstances: 0
    availabilityZone: <subnet-id-zone>
    amiid: <some-ami-id>

  # Required. You can specify a different bucket for the system_bucket
  system_bucket: '{{buckets.internal.name}}'

  # Required. Should be the same as in IAM deployment config.yml
  buckets:
    internal:
        name: dev-internal
        type: internal

  # Required. <iams-prefix> = prefix from IAM stack above.
  iams:
    ecsRoleArn: 'arn:aws:iam::{{AWS_ACCOUNT_ID}}:role/<iams-prefix>-ecs'
    lambdaApiGatewayRoleArn: 'arn:aws:iam::{{AWS_ACCOUNT_ID}}:role/<iams-prefix>-lambda-api-gateway'
    lambdaProcessingRoleArn: 'arn:aws:iam::{{AWS_ACCOUNT_ID}}:role/<iams-prefix>-lambda-processing'
    stepRoleArn: 'arn:aws:iam::{{AWS_ACCOUNT_ID}}:role/<iams-prefix>-steprole'
    instanceProfile: 'arn:aws:iam::{{AWS_ACCOUNT_ID}}:instance-profile/<iams-prefix>-ecs'
    distributionRoleArn: 'arn:aws:iam::{{AWS_ACCOUNT_ID}}:role/<iams-prefix>-distribution-api-lambda'
    scalingRoleArn: 'arn:aws:iam::{{AWS_ACCOUNT_ID}}:role/<iams-prefix>-scaling-role'
    migrationRoleArn: 'arn:aws:iam::{{AWS_ACCOUNT_ID}}:role/<iams-prefix>-migration-processing'

  # Optional
  urs_url: https://uat.urs.earthdata.nasa.gov/ # make sure to include the trailing slash

  # if not specified, the value of the API gateway backend endpoint is used
  # api_backend_url: https://apigateway-url-to-api-backend/ # make sure to include the trailing slash

  # if not specified, the value of the API gateway distribution endpoint is used
  # api_distribution_url: https://apigateway-url-to-distribution-app/ # make sure to include the trailing slash

  # Required. URS users who should have access to the dashboard application.
  users:
    - username: <user>
    - username: <user2>
```

**IMPORTANT NOTE** - The `stackName` for this config **must start with** the value of the resource prefix for the IAM stack. By default, this means that the `stackName` should start with the value of the [`prefix` set for the IAM stack above](#configure-and-deploy-the-iam-stack). However, if you changed the value of the `ResourcePrefix` param in your IAM stack `config.yml`, you would use that value instead.

### Configure EarthData application

The Cumulus stack is expected to authenticate with [Earthdata Login](https://urs.earthdata.nasa.gov/documentation). You must create and register a new application. Use the [User Acceptance Tools (UAT) site](https://uat.urs.earthdata.nasa.gov) unless you changed `urs_url` above. Follow the directions on [how to register an application.](https://wiki.earthdata.nasa.gov/display/EL/How+To+Register+An+Application).  Use any url for the `Redirect URL`, it will be deleted in a later step. Also note the password in step 3 and client ID in step 4 use these to replace `EARTHDATA_CLIENT_ID` and `EARTHDATA_CLIENT_PASSWORD` in the `.env` file in the next step.

### Set up an environment file

_If you're adding a new deployment to an existing configuration repository or re-deploying an existing Cumulus configuration you should skip to [Deploy the Cumulus Stack](deployment-readme#deploy), as these values should already be configured._

Copy `app/.env.sample` to `app/.env` and add CMR/earthdata client [credentials](deployment-readme#credentials):

```shell
  CMR_USERNAME=cmrusername
  CMR_PASSWORD=cmrpassword
  EARTHDATA_CLIENT_ID=clientid
  EARTHDATA_CLIENT_PASSWORD=clientpassword
  VPC_ID=someid
  AWS_SUBNET=somesubnet
  AWS_ACCOUNT_ID=0000000
  TOKEN_SECRET=tokensecret
```

The `TOKEN_SECRET` is a string value used for signing and verifying [JSON Web Tokens (JWTs)](https://jwt.io/) issued by the API. For security purposes, it is strongly recommended that this be a 32-character string.

Note that the `.env.sample` file may be hidden, so if you do not see it, show hidden files.

For security it is highly recommended that you prevent `apps/.env` from being accidentally committed to the repository by keeping it in the `.gitignore` file at the root of this repository.

### Deploy

Once the preceding configuration steps have completed, run the following to deploy Cumulus from your `<daac>-deploy` root directory:

```bash
  $ DEPLOYMENT=<cumulus-deployment-name> \
      AWS_REGION=<region> \ # e.g. us-east-1
      AWS_PROFILE=<profile> \
      npm run deploy
```

You can monitor the progess of the stack deployment from the [AWS CloudFormation Console](https://console.aws.amazon.com/cloudformation/home); this step takes a few minutes.

A successful completion will result in output similar to:

```bash
  $ DEPLOYMENT=<cumulus-deployment-name> \
      AWS_REGION=<region> \ # e.g. us-east-1
      AWS_PROFILE=<profile> \
      npm run deploy
  Generating keys. It might take a few seconds!
  Keys Generated
  keys uploaded to S3

    adding: sf-starter/ (stored 0%)
    adding: sf-starter/index.js (deflated 85%)


    adding: daac-ops-api/ (stored 0%)
    adding: daac-ops-api/index.js (deflated 85%)


    adding: sf-sns-broadcast/ (stored 0%)
    adding: sf-sns-broadcast/index.js (deflated 85%)


    adding: hello-world/ (stored 0%)
    adding: hello-world/index.js (deflated 85%)

  Uploaded: s3://daac-internal/daac-cumulus/lambdas/<HASHNUMBERS>/hello-world.zip
  Uploaded: s3://daac-internal/daac-cumulus/lambdas/<HASHNUMBERS>/sf-starter.zip
  Uploaded: s3://daac-internal/daac-cumulus/lambdas/<HASHNUMBERS>/sf-sns-broadcast.zip
  Uploaded: s3://daac-internal/daac-cumulus/lambdas/<HASHNUMBERS>/daac-ops-api.zip
  Template saved to app/cloudformation.yml
  Uploaded: s3://<prefix>-internal/<prefix>-cumulus/cloudformation.yml
  Waiting for the CF operation to complete
  CF operation is in state of CREATE_COMPLETE

  Here are the important URLs for this deployment:

  Distribution:  https://<kido2r7kji>.execute-api.us-east-1.amazonaws.com/dev/
  Add this url to URS:  https://<kido2r7kji>.execute-api.us-east-1.amazonaws.com/dev/redirect

  Api:  https://<czbbkscuy6>.execute-api.us-east-1.amazonaws.com/dev/
  Add this url to URS:  https://<czbbkscuy6>.execute-api.us-east-1.amazonaws.com/dev/token

  Uploading Workflow Input Templates
  Uploaded: s3://<prefix>-internal/<prefix>-cumulus/workflows/HelloWorldWorkflow.json
  Uploaded: s3://<prefix>-internal/<prefix>-cumulus/workflows/list.json
```

__Note:__ Be sure to copy the urls, as you will use them to update your EarthData application.

### Update Earthdata Application.

You will need to add two redirect urls to your EarthData login application.
Login to URS (UAT), and under My Applications -> Application Administration -> use the edit icon of your application.  Then under Manage -> redirect URIs, add the Backend API url returned from the stack deployment, e.g. `https://<czbbkscuy6>.execute-api.us-east-1.amazonaws.com/dev/token`.
Also add the Distribution url `https://<kido2r7kji>.execute-api.us-east-1.amazonaws.com/dev/redirect`[^3]. You may also delete the placeholder url you used to create the application.

If you've lost track of the needed redirect URIs, they can be located on the [API Gateway](https://console.aws.amazon.com/apigateway).  Once there select `<prefix>-backend` and/or `<prefix>-distribution`, `Dashboard` and utilizing the base URL at the top of the page that is accompanied by the text `Invoke this API at:`.   Make sure to append `/token` for the backend URL and `/redirect` to the distribution URL.

--------------

## Deploy Cumulus dashboard

### Dashboard Requirements

Please note that the requirements are similar to the [Cumulus stack deployment requirements](deployment-readme#requirements), however the node version may vary slightly and the dashboard requires yarn.    The installation instructions below include a step that will install/use the required node version referenced in the `.nvmrc` file in the dashboard repository.

* git
* [node 8.11.4](https://nodejs.org/en/) (use [nvm](https://github.com/creationix/nvm) to upgrade/downgrade)
* [npm](https://www.npmjs.com/get-npm)
* [yarn](https://yarnpkg.com/en/docs/install#mac-stable)
* sha1sum or md5sha1sum
* zip
* AWS CLI - [AWS command line interface](https://aws.amazon.com/cli/)
* python

### Prepare AWS

**Create S3 bucket for dashboard:**

* Create it, e.g. `<prefix>-dashboard`. Use the command line or console as you did when [preparing AWS configuration](deployment-readme#prepare-aws-configuration).
* Configure the bucket to host a website:
  * AWS S3 console: Select `<prefix>-dashboard` bucket then, "Properties" -> "Static Website Hosting", point to `index.html`
  * CLI: `aws s3 website s3://<prefix>-dashboard --index-document index.html`
* The bucket's url will be `http://<prefix>-dashboard.s3-website-<region>.amazonaws.com` or you can find it on the AWS console via "Properties" -> "Static website hosting" -> "Endpoint"
* Ensure the bucket's access permissions allow your deployment user access to write to the bucket

### Install dashboard

To install the dashboard clone the Cumulus-dashboard repository into the root deploy directory and install dependencies with `yarn install`:

```bash
  $ git clone https://github.com/nasa/cumulus-dashboard
  $ cd cumulus-dashboard
  $ nvm use
  $ yarn install
```

If you do not have the correct version of node installed, replace `nvm use` with `nvm install $(cat .nvmrc)` in the above example.

#### Dashboard versioning

By default, the `master` branch will be used for dashboard deployments. The `master` branch of the dashboard repo contains the most recent stable release of the dashboard.

If you want to test unreleased changes to the dashboard, use the `develop` branch.

Each [release/version of the dashboard](https://github.com/nasa/cumulus-dashboard/releases) will have [a tag in the dashboard repo](https://github.com/nasa/cumulus-dashboard/tags). Release/version numbers will use semantic versioning (major/minor/patch).

To checkout and install a specific version of the dashboard:

```bash
  $ git fetch --tags
  $ git checkout <version-number> # e.g. v1.2.0
  $ nvm use
  $ yarn install
```

If you do not have the correct version of node installed, replace `nvm use` with `nvm install $(cat .nvmrc)` in the above example.

### Dashboard configuration

To configure your dashboard for deployment, update `cumulus-dashboard/app/scripts/config/config.js` by replacing the default apiRoot `https://wjdkfyb6t6.execute-api.us-east-1.amazonaws.com/dev/` with your app's apiRoot:[^2]

```javascript
    apiRoot: process.env.APIROOT || 'https://<czbbkscuy6>.execute-api.us-east-1.amazonaws.com/dev/'
```

### Building the dashboard

**Note**: These environment variables are available during the build: `APIROOT`, `DAAC_NAME`, `STAGE`, `HIDE_PDR`. Any of these can be set on the command line to override the values contained in `config.js` when running the build below.

Build the dashboard from the dashboard repository root directory, `cumulus-dashboard`:

```bash
  $ npm run build
```

### Dashboard deployment

Deploy dashboard to s3 bucket from the `cumulus-dashboard` directory:

Using AWS CLI:

```bash
  $ aws s3 sync dist s3://<prefix>-dashboard --acl public-read
```

From the S3 Console:

* Open the `<prefix>-dashboard` bucket, click 'upload'. Add the contents of the 'dist' subdirectory to the upload. Then select 'Next'. On the permissions window allow the public to view. Select 'Upload'.

You should be able to visit the dashboard website at `http://<prefix>-dashboard.s3-website-<region>.amazonaws.com` or find the url
`<prefix>-dashboard` -> "Properties" -> "Static website hosting" -> "Endpoint" and login with a user that you configured for access in the [Configure and Deploy the Cumulus Stack](deployment-readme#configure-and-deploy-the-cumulus-stack) step.

--------------

## Updating Cumulus deployment

Once deployed for the first time, any future updates to the role/stack configuration files/version of Cumulus can be deployed and will update the appropriate portions of the stack as needed.

## Update roles

```bash
  $ DEPLOYMENT=<iam-deployment-name> \
      AWS_REGION=<region> \ # e.g. us-east-1
      AWS_PROFILE=<profile> \
      npm run deploy-iam
```

## Cumulus Versioning

Cumulus uses a global versioning approach, meaning version numbers are consistent across all packages and tasks, and semantic versioning to track major, minor, and patch version (i.e. 1.0.0). We use Lerna to manage versioning.

## Update Cumulus

```bash
  $ DEPLOYMENT=<cumulus-deployment-name> \
      AWS_REGION=<region> \ # e.g. us-east-1
      AWS_PROFILE=<profile> \
      npm run deploy
```

### Footnotes

[^1]: The iam  actions require more permissions than a typical AWS user will have and should be run by an administrator.

[^2]: The API root can be found a number of ways. The easiest is to note it in the output of the app deployment step. But you can also find it from the `AWS console -> Amazon API Gateway -> APIs -> <prefix>-cumulus-backend -> Dashboard`, and reading the URL at the top "invoke this API"

[^3]: To add another redirect URIs to your application. On EarthData home page, select "My Applications" Scroll down to "Application Administration" and use the edit icon for your application.  Then Manage -> Redirect URIs.
