---
id: version-v1.10.1-deployment-readme
title: How to Deploy Cumulus
hide_title: true
original_id: deployment-readme
---

# How to Deploy Cumulus

## Overview

This is a guide for deploying a new instance of Cumulus.

The deployment documentation is current for the following component versions:

* [Cumulus](https://github.com/nasa/cumulus)
* [Deployment Template](https://github.com/nasa/template-deploy)
* [Cumulus Dashboard](https://github.com/nasa/cumulus-dashboard)

The process involves:

*  Creating [AWS S3 Buckets](https://docs.aws.amazon.com/AmazonS3/latest/dev/UsingBucket.html).
*  Using [Kes](http://devseed.com/kes/) to transform kes templates (`cloudformation.template.yml`) into [AWS CloudFormation](https://aws.amazon.com/cloudformation/getting-started/) stack templates (`cloudformation.yml`) that are then deployed to AWS.
*  Before deploying the Cumulus software, CloudFormation stacks are deployed that create necessary [IAM roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html) via the `deployer` and `iams` stacks.
*  The Cumulus software is configured and deployed via the `app` stack.

--------------
## Requirements

#### Linux/MacOS software requirements:

- git
- [node 8.10](https://nodejs.org/en/) (use [nvm](https://github.com/creationix/nvm) to upgrade/downgrade)
- [npm](https://www.npmjs.com/get-npm)
- sha1sum or md5sha1sum
- zip

- AWS CLI - [AWS command line interface](https://aws.amazon.com/cli/)
- python

#### Credentials:


* [CMR](https://earthdata.nasa.gov/about/science-system-description/eosdis-components/common-metadata-repository) username and password.  Can be excluded if you are not exporting metadata to CMR.

* [EarthData Client login](https://earthdata.nasa.gov/about/science-system-description/eosdis-components/earthdata-login) username and password. User must have the ability to administer and/or create applications in URS.   It's recommended to obtain an account in the test environment (UAT).


#### Needed Git Repositories:

- [Cumulus](https://github.com/nasa/cumulus) (optional)
- [Cumulus Dashboard](https://github.com/nasa/cumulus-dashboard)
- [Deployment Template](https://github.com/nasa/template-deploy)


## Installation

#### Prepare DAAC deployment repository {#prepare-deployment}

_If you already are working with an existing `<daac>-deploy` repository that is configured appropriately for the version of Cumulus you intend to deploy or update, skip to [Prepare AWS configuration. ](#prepare-config)_

Clone template-deploy repo and name appropriately for your DAAC or organization

    $ git clone https://github.com/nasa/template-deploy <daac>-deploy

Enter repository root directory

    $ cd <daac>-deploy

Then run:

    $ npm install

**Note**: The npm install command will add the [kes](http://devseed.com/kes/) utility to the `<daac>-deploy`'s `node_packages` directory and will be utilized later for most of the AWS deployment commands

#### Obtain Cumulus Packages

##### Option 1: Get packages from NPM

Packages are installed with npm. A list of Cumulus packages with descriptions and version information can be found [here](https://www.npmjs.com/org/cumulus).

If you're trying to work with a certain version of a cumulus package or task, the version can be specified in `package.json` under dependencies. We use semantic versioning (major/minor/patch). You can also configure for automatic updates. Use `^` to update minor/patch versions automatically and `~` to automatically update patch versions. For example:

    "@cumulus/sync-granule": "^1.0.0"

To add a new package to your deployment, install via npm. Without a version specified, it will automatically install the latest version. For example:

    $ npm install --save @cumulus/deployment

To use the specific version of the package installed during deployment, point the `source` key in the lambda config to `node_modules/@cumulus/<package-name>/dist`. This location may vary between packages, so consult the README in each. For example, the following would update patch and minor versions of sync-granule:

    SyncGranule:
      source: 'node_modules/@cumulus/sync-granule/dist/'

##### Option 2: Make local copy of the `Cumulus` Repo and prepare it.

Clone repository

    $ git clone https://github.com/nasa/cumulus.git

Change directory to the repository root

    $ cd cumulus

Optionally, If you are deploying a particular version(tag), ref or branch of Cumulus core, you should check out that particular reference

    $ git checkout \<ref/branch/tag\>

Install and configure the local build environment and dependencies using npm

    $ nvm use
    $ npm install
    $ npm run ybootstrap

Build the Cumulus application

    $ npm run build

To run the Cumulus deployment with the local code instead of the npm package, use `npm link` from your deployment repository directory

    $ npm link ../cumulus/packages/deployment/ @cumulus/deployment

Note: If you get errors with `npm link`, try deleting the `node_modules` folder the package you are trying to link to in the Cumulus repository.

##### Copy the sample template into your repository {#copy-template}

The [`Cumulus`](https://github.com/nasa/cumulus) project contains default configuration values in the `app.example` folder, however these need to be customized for your Cumulus app.

Begin by copying the template directory to your project. You will modify it for your DAAC's specific needs later.

    $ cp -r ./node_modules/@cumulus/deployment/app.example ./app

**Optional:** [Create a new repository](https://help.github.com/articles/creating-a-new-repository/) `<daac>-deploy` so that you can track your DAAC's configuration changes:

    $ git remote set-url origin https://github.com/nasa/<daac>-deploy
    $ git push origin master

You can then [add/commit](https://help.github.com/articles/adding-a-file-to-a-repository-using-the-command-line/) changes as needed.


#### Prepare AWS configuration  {#prepare-config}

**Set Access Keys:**

You need to make some AWS information available to your environment. If you don't already have the access key and secret access key of an AWS user with IAM Create-User permissions, you must [Create Access Keys](https://docs.aws.amazon.com/general/latest/gr/managing-aws-access-keys.html) for such a user with IAM Create-User permissions, then export the access keys:


    $ export AWS_ACCESS_KEY_ID=<AWS access key>
    $ export AWS_SECRET_ACCESS_KEY=<AWS secret key>
    $ export AWS_REGION=<region>

If you don't want to set environment variables, [access keys can be stored locally via the AWS CLI.](http://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html)


#### Create S3 Buckets:

See [creating s3 buckets](deployment/create_bucket.md) for more information on how to create a bucket.

The following s3 bucket should be created (replacing prefix with whatever you'd like, generally your organization/DAAC's name):


* `<prefix>-internal`

You can create additional s3 buckets based on the needs of your workflows.

These buckets do not need any non-default permissions to function with Cumulus, however your local security requirements may vary.


**Note**: s3 bucket object names are global and must be unique across all accounts/locations/etc.

--------------
## Configure and Deploy the IAM stack

##### Configure deployment with `<daac>-deploy/iam/config.yml`

The `iam` configuration creates 6 [roles](http://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html) and an [instance profile](http://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2_instance-profiles.html) used internally by the Cumulus stack.

The various config fields are described below with a sample `config.yml` at the end.

------

###### iam-deployment-name:

The name (e.g. dev) of the the 'deployment' - this key tells kes which configuration set (in addition to the default values) to use when creating the cloud formation template[^4]

###### prefix:

This value will prefix CloudFormation-created IAM resources and permissions.

**The cumulus stack name must start with `<prefix>`** [^5]

###### stackName:

The name of this iam stack in CloudFormation (e.g. <prefix>-iam).

###### buckets:

The buckets created in the [Create S3 Buckets](#create-s3-buckets) step. Buckets are defined in the config.yml with a key, name, and type. Types should be one of: internal, public, private, or protected. Multiple buckets of each type can be configured. A key is used for the buckets to allow for swapping out the bucket names easily.

------

**Sample new deployment added to config.yml**:

    <iam-deployment-name>:    # e.g. dev (Note: Omit brackets, i.e. NOT <dev>)
      prefix: <stack-prefix>  # prefixes CloudFormation-created iam resources and permissions
      stackName: <stack-name> # name of this iam stack in CloudFormation (e.g. <prefix>-iams)
      system_bucket: '{{buckets.internal.name}}' # Or can specify a different bucket for the system_bucket
      buckets:
        internal: # bucket key
            name: <internal bucket name>
            type: internal

**Deploy `iam` stack**[^1]

    $ ./node_modules/.bin/kes cf deploy --kes-folder iam --deployment <iam-deployment-name> --template node_modules/@cumulus/deployment/iam --region <region>

**Note**: If this deployment fails check the deployment details in the AWS Cloud Formation Console for information. Permissions may need to be updated by your AWS administrator.

If the `iam` deployment command  succeeds, you should see 6 new roles in the [IAM Console](https://console.aws.amazon.com/iam/home):

* `<stack-name>-ecs`
* `<stack-name>-lambda-api-gateway`
* `<stack-name>-lambda-processing`
* `<stack-name>-scaling-role`
* `<stack-name>-steprole`
* `<stack-name>-distribution-api-lambda`


The same information can be obtained from the AWS CLI command: `aws iam list-roles`.

The `iam` deployment also creates an instance profile named `<stack-name>-ecs` that can be viewed from the AWS CLI command: `aws iam list-instance-profiles`.

--------------
## Configure and Deploy the Cumulus stack

These updates configure the [copied template](#copy-template) from the cumulus repository for your DAAC.

You should either add a new root-level key for your configuration or modify the existing default configuration key to whatever you'd like your new deployment to be.

If you're re-deploying based on an existing configuration you can skip this configuration step unless values have been updated *or* you'd like to add a new deployment to your deployment configuration file.

**Edit the  `<daac>-deploy/app/config.yml` file **

The various configuration sections are described below with a sample `config.yml` at the end:

-----

###### cumulus-deployment-name:

The name (e.g. dev) of the the 'deployment' - this key tells kes which configuration set (in addition to the default values) to use when creating the cloud formation template[^4]

###### stackName:

The name of this stack in CloudFormation (e.g. <prefix>).    **This stack name must start with the prefix listed in the [IAM](#create-iam-roles) role configuration, or the deployment will fail.**

###### stackNameNoDash:

A representation of the stack name that has dashes removed. This will be used for components that should be associated with the stack but do not allow dashes in the identifier.

###### vpc

Configure your virtual private cloud.  You can find `<vpc-id>` and `<subnet-id>` values on the [VPC Dashboard](https://console.aws.amazon.com/vpc/home?region=us-east-1#). `vpcId` from [Your VPCs](https://console.aws.amazon.com/vpc/home?region=us-east-1#vpcs:), and `subnets` [here](https://console.aws.amazon.com/vpc/home?region=us-east-1#subnets:). When you choose a subnet, be sure to also note its availability zone, to configure `ecs`.


###### ecs

Configuration for the Amazon EC2 Container Service (ECS) instance.  Update `availabilityZone` (or `availabilityZones` if using multiple AZs) with information from [VPC Dashboard](https://console.aws.amazon.com/vpc/home?region=us-east-1#)
note `instanceType` and `desiredInstances` have been selected for a sample install.  You will have to specify appropriate values to deploy and use ECS machines.   See [EC2 Instance Types](http://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-types.html) for more information.

Also note, if you dont specify the `amiid`, it will try to use a default, which may or may not exist.

###### buckets

The config buckets should map to the same names you used when creating buckets in the [Prepare AWS](#prepare-config) step. Buckets are defined in the config.yml with a key, name, and type. Types should be one of: internal, public, private, or protected. Multiple buckets of each type can be configured.

###### iams

Add the ARNs for each of the four roles and one instanceProfile created in the [Create IAM Roles](create-iam-roles) step. You can retrieve the ARNs from:

    $ aws iam list-roles | grep Arn
    $ aws iam list-instance-profiles | grep Arn

For information on how to locate them in the Console see [Locating Cumulus IAM Roles](iam_roles.md).

###### users

List of EarthData users you wish to have access to your dashboard application.   These users will be populated in your `<stackname>-UsersTable` [DynamoDb](https://console.aws.amazon.com/dynamodb/) (in addition to the default_users defined in the Cumulus default template).

-----

###### Sample config.yml

```
<cumulus-deployment-name>:
  stackName: <prefix>-cumulus
  stackNameNoDash: <Prefix>Cumulus

  apiStage: dev

  vpc:
    vpcId: <vpc-id>
    subnets:
      - <subnet-id>

  ecs:
    instanceType: t2.micro
    desiredInstances: 0
    availabilityZone: <subnet-id-zone>
    amiid: <some-ami-id>

  system_bucket: <prefix-internal>

  buckets:
    internal:
        name: <prefix>-internal
        type: internal

  iams:
    ecsRoleArn: arn:aws:iam::<aws-account-id>:role/<iams-prefix>-ecs
    lambdaApiGatewayRoleArn: arn:aws:iam::<aws-account-id>:role/<iams-prefix>-lambda-api-gateway
    lambdaProcessingRoleArn: arn:aws:iam::<aws-account-id>:role/<iams-prefix>-lambda-processing
    stepRoleArn: arn:aws:iam::<aws-account-id>:role/<iams-prefix>-steprole
    instanceProfile: arn:aws:iam::<aws-account-id>:instance-profile/<iams-prefix>-ecs

  urs_url: https://uat.urs.earthdata.nasa.gov/ #make sure to include the trailing slash

  # if not specified the value of the apigateway backend endpoint is used
  # api_backend_url: https://apigateway-url-to-api-backend/ #make sure to include the trailing slash

  # if not specified the value of the apigateway dist url is used
  # api_distribution_url: https://apigateway-url-to-distribution-app/ #make sure to include the trailing slash

  # URS users who should have access to the dashboard application.
  users:
    - username: <user>
    - username: <user2>
```

##### Configure EarthData application

The Cumulus stack is expected to authenticate with [Earthdata Login](https://urs.earthdata.nasa.gov/documentation). You must create and register a new application. Use the [User Acceptance Tools (UAT) site](https://uat.urs.earthdata.nasa.gov) unless you changed `urs_url` above. Follow the directions on [how to register an application.](https://wiki.earthdata.nasa.gov/display/EL/How+To+Register+An+Application).  Use any url for the `Redirect URL`, it will be deleted in a later step. Also note the password in step 3 and client ID in step 4 use these to replace `clientid` and `clientpassword` in the `.env` file in the next step.

##### Set up an environment file:

_If you're adding a new deployment to an existing configuration repository or re-deploying an existing Cumulus configuration you should skip to [Deploy the Cumulus Stack](#deploy-the-cumulus-stack), as these values should already be configured._

Copy `app/.env.sample to app/.env` and add CMR/earthdata client [credentials](#Credentials):

    CMR_PASSWORD=cmrpassword
    EARTHDATA_CLIENT_ID=clientid
    EARTHDATA_CLIENT_PASSWORD=clientpassword

Note that the `.env.sample` file may be hidden, so if you do not see it, show hidden files.

For security it is highly recommended that you prevent `apps/.env` from being accidentally committed to the repository by keeping it in the `.gitignore` file at the root of this repository.

#### Deploy

Once the preceding configuration steps have completed, run the following to deploy Cumulus from your `<daac>-deploy` root directory:

    $ ./node_modules/.bin/kes cf deploy --kes-folder app --region <region> \
      --template node_modules/@cumulus/deployment/app \
      --deployment <cumulus-deployment-name>


You can monitor the progess of the stack deployment from the [AWS CloudFormation Console](https://console.aws.amazon.com/cloudformation/home); this step takes a few minutes.


A successful completion will result in output similar to:

	 $ ./node_modules/.bin/kes cf deploy --kes-folder app --region <region>
       --template node_modules/@cumulus/deployment/app --deployment daac
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


__Note:__ Be sure to copy the urls, as you will use them to update your EarthData application.

##### Update Earthdata Application.

You will need to add two redirect urls to your EarthData login application.
Login to URS (UAT), and under My Applications -> Application Administration -> use the edit icon of your application.  Then under Manage -> redirect URIs, add the Backend API url returned from the stack deployment, e.g. `https://<czbbkscuy6>.execute-api.us-east-1.amazonaws.com/dev/token`.
Also add the Distribution url `https://<kido2r7kji>.execute-api.us-east-1.amazonaws.com/dev/redirect`[^3]. You may also delete the placeholder url you used to create the application.

If you've lost track of the needed redirect URIs, they can be located on the [API Gateway](https://console.aws.amazon.com/apigateway).  Once there select `<prefix>-backend` and/or `<prefix>-distribution`, `Dashboard` and utilizing the base URL at the top of the page that is accompanied by the text `Invoke this API at:`.   Make sure to append `/token` for the backend URL and `/redirect` to the distribution URL.

----
## Deploy Cumulus dashboard

### Prepare AWS

**Create S3 bucket for dashboard:**

* Create it, e.g. `<prefix>-dashboard`. Use the command line or console as you did when [preparing AWS configuration](#Prepare AWS configuration).
* Configure the bucket to host a website:
  * AWS S3 console: Select `<prefix>-dashboard` bucket then, "Properties" -> "Static Website Hosting", point to `index.html`
  * CLI: `aws s3 website s3://<prefix>-dashboard --index-document index.html`
* The bucket's url will be `http://<prefix>-dashboard.s3-website-<region>.amazonaws.com` or you can find it on the AWS console via "Properties" -> "Static website hosting" -> "Endpoint"
 * Ensure the bucket's access permissions allow your deployment user access to write to the bucket

### Install dashboard

To install the dashboard clone the Cumulus-dashboard repository into the root deploy directory and install dependencies with `npm install`:

    $ git clone https://github.com/nasa/cumulus-dashboard
    $ cd cumulus-dashboard
    $ npm install

### Dashboard configuration

Configure dashboard:

Update config in `cumulus-dashboard/app/scripts/config/config.js`:

replace the default apiRoot `https://wjdkfyb6t6.execute-api.us-east-1.amazonaws.com/dev/` with your app's apiroot.[^2]

    apiRoot: process.env.APIROOT || 'https://<czbbkscuy6>.execute-api.us-east-1.amazonaws.com/dev/'


**Note**  environmental variables are available during the build: `APIROOT`, `DAAC_NAME`, `STAGE`, `HIDE_PDR`, any of these can be set on the command line to override the values contained in `config.js` when running the build below.


Build the dashboard from the dashboard repository root directory, `cumulus-dashboard`:

      $ npm run build


### Dashboard deployment:

Deploy dashboard to s3 bucket from the `cumulus-dashboard` directory:

Using AWS CLI:

      $ aws s3 sync dist s3://<prefix>-dashboard --acl public-read

From the S3 Console:

* Open the `<prefix>-dashboard` bucket, click 'upload'. Add the contents of the 'dist' subdirectory to the upload. Then select 'Next'. On the permissions window allow the public to view. Select 'Upload'.

You should be able to visit the dashboard website at `http://<prefix>-dashboard.s3-website-<region>.amazonaws.com` or find the url
`<prefix>-dashboard` -> "Properties" -> "Static website hosting" -> "Endpoint" and login with a user that you configured for access in the [Configure Cumulus Stack](#configure-cumulus-stack) step.



----
## Updating Cumulus deployment

Once deployed for the first time, any future updates to the role/stack configuration files/version of Cumulus can be deployed and will update the appropriate portions of the stack as needed.

## Update roles

    $ ./node_modules/.bin/kes cf deploy --kes-folder iam --deployment <deployment-name> \
      --region <region> # e.g. us-east-1

## Cumulus Versioning

Cumulus uses a global versioning approach, meaning version numbers are consistent across all packages and tasks, and semantic versioning to track major, minor, and patch version (i.e. 1.0.0). We use Lerna to manage versioning. Any change will force lerna to increment the version of all packages.

### Publishing to NPM

    $ lerna publish

To specify the level of change for the new version

    $ lerna publish --cd-version (major | minor | patch | prerelease)

## Update Cumulus

    $ kes cf deploy --kes-folder config --region <region> \
      --deployment <deployment-name>


### Footnotes:

[^1]: The iam  actions require more permissions than a typical AWS user will have and should be run by an administrator.

[^2]: The API root can be found a number of ways. The easiest is to note it in the output of the app deployment step. But you can also find it from the `AWS console -> Amazon API Gateway -> APIs -> <prefix>-cumulus-backend -> Dashboard`, and reading the url at the top "invoke this API"

[^3]: To add another redirect URIs to your application. On EarthData home page, select "My Applications" Scroll down to "Application Administration" and use the edit icon for your application.  Then Manage -> Redirect URIs.
[^4]: This value is used by kes only to identify the configuration set to use and should not appear in any AWS object
[^5]: For more on the AWS objects this impacts, you can look through iam/cloudformation.template.yml
