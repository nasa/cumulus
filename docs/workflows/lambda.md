---
id: lambda
title: Develop Lambda Functions
hide_title: true
---

# Develop Lambda Functions

## Develop a new Lambda

To develop a new Lambda from a sample, create a new folder in `cumulus/tasks/` and run `npm init`:

```bash
  $ cd ../cumulus/tasks
  $ mkdir new-lambda
  $ cd new-lambda
  $ npm init
```

Or copy an existing Lambda function to customize:

```bash
  $ cd ../cumulus/tasks
  $ cp discover-pdrs new-lambda
```

Modify package.json:

* name
* version
* description
* test script
* dependencies (NOT devDependencies)

## Build a Lambda

To build Node.js Lambda functions, use webpack to pack the Lambda code into a single `.js` file with dependencies:

```bash
  $ npm run build
```

Alternatively, to monitor for changes and auto-rebuild:

```bash
  $ npm run watch
```

For non-node Lambdas not included in Cumulus repo, upload .zip to s3 and modify lambdas.yml as previously shown.

## Deploy a Lambda

For new Node.js Lambdas, update `<daac>-deploy/lambdas.yml` by adding a new entry.

```yaml
    <LambdaName>:                                   # eg:  LambdaSample (does not need to conform to dirname)
      handler: <dir>.<function>                     # eg:  sample-lambda.handler (assuming file has module.exports.handler = <someFunc>)
      timeout: <s>                                  # eg:  300
      source: 'node_modules/@cumulus/<dir>/dist/'   # eg:  '../cumulus/cumulus/tasks/sample-lambda/dist/index.js'
```

For non-Node.js Lambda code (e.g. python) uploaded as a .zip to an S3 bucket:

```yaml
  PyLambda:
    handler: <file.py>.<function>               # eg:  lambda_handler.handler for lambda_handler.py with:  def handler(event, context):
    timeout: <s>
    s3Source:
      bucket: '{{buckets.internal.name}}'       # refers to bucket set in config.yml
      key: deploy/cumulus-process/<dir>/<file>  # eg: deploy/cumulus-process/modis/0.3.0b3.zip
    runtime: python2.7                          # Node is default, otherwise specify.
    layers:
      - <some layer ARN>
```

Other configurable options for Lambdas:

```yaml
  useXray: true             # Enable AWS X-Ray for the Lambda
  launchInVpc: true         # Launch the Lambda in a VPC. Requires VPC configuration for the deployment.
  logToElasticSearch: true  # Write Lambda execution logs to Elasticsearch.
  useMessageAdapter: true   # Option to add/inject CMA as part of a cumulus workflow.  The CMA layer may be used instead
  envs:                     # Add named environment variables for your Lambda.
    - foo: 'bar'
  layers:                   # Optional. e.g.: 'arn:aws:lambda:us-east-1:{{AWS_ACCOUNT_ID}}:layer:Cumulus_Message_Adapter:3'
    - <layer1-arn>
```

To deploy all changes to `/tasks/` and `lambdas.yml`:

```bash
  $ kes cf deploy --kes-folder app --template node_modules/@cumulus/deployment/app --region <region> --deployment <deployment-name>
```

To deploy modifications to a single Lambda package:

```bash
  $ kes lambda <LambdaName> --kes-folder app --template node_modules/@cumulus/deployment/app --deployment <deployment-name>
```

**Note:** By default, Cumulus workflows use versioned references to Lambdas and deploying a single Lambda does not update those references. So if you re-deploy just a single workflow Lambda, then any workflows using that Lambda will not be using the latest version of your Lambda code. 

You have to re-deploy your entire Cumulus application for workflows to reference the latest version of your Lambda code. Or you can disable workflow Lambda versioning by setting `useWorkflowLambdaVersions: false` for your deployment as a root key in your configuration.   For more information on this feature, see [the lambda version feature documentation](features/lambda_versioning.md).


