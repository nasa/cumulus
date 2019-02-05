---
id: lambda_versioning
title: Lambda Versioning
hide_title: true
---

# Lambda Versioning
Cumulus makes use of AWS's Lambda/Alias version objects to tag and retain references to recent copies of deployed workflow lambdas.

All Cumulus deployed lambdas in lambdas.yml will have an alias/version resource created. Lambdas with source coming from S3 must be expressly configured to take advantage of versioning.

A reference to the most current lambda version alias will replace the unversioned lambda resource ARN in all workflows for each task that is either built via Cumulus, or defined via the uniqueIdentifier configuration key for s3 sourced lambdas.

A configurable number of previously deployed alias/version pairs will be retained to ensure that in-progress workflows are able to complete.

This allows for workflows to automatically reference the specific version of a lambda function they were deployed with, prevents an updated deployment of an existing lambda from being utilized in an already in-progress workflow, and retains the executed version information in the AWS step function execution record and CloudWatch logs.

**Please note** that care must be exercised to not update lambda versions and redeploy frequently enough that an in-progress workflow refers to an aged-off version of a lambda, or workflows that reference such a lambda may fail.

( See [AWS Lambda Function Versioning and Aliases](https://docs.aws.amazon.com/lambda/latest/dg/versioning-aliases.html) for more on lambda versions/aliases)

## Configuration

This feature is enabled by default for all Cumulus built/deployed lambdas, as well as s3Source lambdas that are configured as described below.  s3Source Lambdas that are not configured will continue to utilize an unqualified reference and will not utilize lambda versioning.

### s3Source Lambda Version Configuration

Lambdas with s3Source defined currently require additional configuration to make use of this feature in the form of a 'uniqueIdentifier' key:

```
SomeLambda:
  Handler: lambda_handler.handler
  timeout: 300
  s3Source:
    bucket: '{{some_bucket}}'
    key: path/some-lambda.zip
    uniqueIdentifier: '5dot2'
  runtime: python2.7
```

That key, due to AWS constraints, must be letters (```[a-zA-Z]```) only.

Note that if the lambda is configured to run in a VPC and the VPC settings change, you will need to manually update the `uniqueIdentifier`.

### Changing Number of Retained Lambdas

The default number of retained lambda versions is 1.

This can be overridden by adding the following key to your configuration file:

`maxNumberOfRetainedLambdas: X`

where X is the number of previous versions you wish to retain.

This feature allows a variable number of retained lambdas, however due to CloudFormation limits and current implementation constraints, that number is fairly limited.

The ```WorkflowLambdaVersions``` sub-template is constrained to 200 total resources, in addition to only being able to output 60 aliases back to the master template.   As such, the limit on the template is:

```(200/2+2*RV)-2``` where RV = total number of retained versions.

Given the available limits, the following are the pratical limits on the number of lambdas that can be configured for a given number of retained lambdas:

* 1: 48

* 2: 31

* 3: 23

### Disabling Lambda Versioning

This feature is enabled by default in the deployment package template, but can be disabled by adding the following key to your app/config.yml:

```
useWorkflowLambdaVersions: false
```

Disabling this feature will result in Cumulus not creating alias/version lambda resource objects, the `WorkflowLambdaVersions` stack will not be created and the deployed workflow lambda references will be unqualified (always referring to the latest version).

Disabling this feature after deploying a stack with it enabled will remove the `WorkflowLambdaVersions` stack, remove all Cumulus defined lambda Version/Alias pairs and reset all workflows to using an unqualified lambda reference.     Workflows in progress with incomplete steps that have references to versioned lambdas will fail.
